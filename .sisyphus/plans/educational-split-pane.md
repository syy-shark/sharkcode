# SharkCode 教育型双栏模式 (Educational Split-Pane TUI)

## TL;DR
> **Summary**: 为 SharkCode 添加 `/teach` 教育模式——全屏 Ink 双栏 TUI，左栏显示 agent 执行流程，右栏显示中文教学讲解（并行 LLM 调用生成）。
> **Deliverables**: `/teach` 命令、事件总线层、教学流编排器、Ink 双栏 UI、配置持久化、测试覆盖
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 (config) → Task 2 (events) → Task 5 (orchestrator) → Task 6 (Ink UI) → Task 8 (integration)

## Context

### Original Request
用户希望将 SharkCode 打造成**教育型 coding agent**，主要面向：
- 中国大学生
- Vibe Coding 用户
- 想通过 AI 提升编程能力的人

核心差异化：终端全屏显示，左边执行、右边教学。

### Interview Summary
通过多轮问答确认的关键决策：
- **TUI 框架**: Ink (React for CLI)，仅用于教育模式
- **教学内容生成**: 第二次并行 LLM 调用（非 prompt 注入）
- **激活方式**: 默认关闭，`/teach` 开启，`/teach off` 关闭
- **MVP 范围**: 双栏布局 + 实时教学流
- **教学模型**: 用户可配置，与执行模型分离
- **教学语言**: 中文
- **教学详略**: 三档可调（简洁/标准/详细）
- **适用场景**: 仅交互式 REPL 多轮对话
- **失败策略**: 教学流失败不影响主执行，右栏显示降级提示
- **教学输入**: 完整上下文（用户提示、工具名、参数、结果、错误）

### Metis Review (gaps addressed)
- ✅ **两条执行路径**: `generateText` 和 `streamText` 都需要归一化为统一事件模型
- ✅ **Permission UI 冲突**: 权限提示直接写 stderr，需要在教育模式下特殊处理
- ✅ **输入所有权**: raw mode、Esc 中断、权限提示、setup flows 都竞争 stdin
- ✅ **lossy context**: 当前工具输出被截断，需要在截断前捕获完整事件供教学用
- ✅ **单例状态**: interrupt/spinner 是进程全局的，教育模式需要兼容

## Work Objectives

### Core Objective
在不破坏现有 CLI 的前提下，为 SharkCode 添加可选的教育模式，通过双栏 TUI 实时展示执行过程和中文教学讲解。

### Deliverables
1. `/teach` 系列命令（开启/关闭/配置）
2. 教育模式配置持久化
3. 渲染器无关的事件总线层
4. 教学流编排器（并行 LLM 调用）
5. Ink 双栏 UI 组件
6. 完整测试覆盖
7. 文档更新

### Definition of Done (verifiable conditions with commands)
- `bun run build` 成功
- `bun test` 全部通过
- `/teach` 在交互模式下可开启教育模式
- `/teach off` 可关闭教育模式
- `/teach level 简洁|标准|详细` 可调整教学详略
- `/teach model <model>` 可配置教学模型
- 教学流失败时主执行继续，右栏显示「教学讲解暂时不可用」
- 非 TTY 环境自动降级到普通模式
- 终端宽度不足时自动降级

### Must Have
- 事件总线层，解耦 agent 事件与渲染
- 支持 `streamText` 和 `generateText` 两条路径
- 教学 LLM 并行调用
- 配置持久化到 `~/.sharkcode/config.toml`
- 三档教学详略
- 降级处理（教学失败、非 TTY、窄终端）
- Esc 中断在教育模式下正常工作
- 权限提示在教育模式下正常工作

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- ❌ 不迁移普通 REPL 到 Ink
- ❌ 不支持单次运行模式（sharkcode "..."）的教育模式
- ❌ 不支持多语言教学（MVP 仅中文）
- ❌ 不支持 shell 输出实时教学（当前 bash 工具缓冲输出）
- ❌ 不新增 `teachingProvider` 字段（复用当前 provider）
- ❌ 不做教学历史/回放/进度追踪
- ❌ 不做独立滚动（MVP 用简单自动滚动）
- ❌ 不用"用户目视确认"作为验收标准

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- **Test decision**: tests-after + vitest
- **QA policy**: Every task has agent-executed scenarios
- **Evidence**: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

测试类型：
1. **单元测试**: 配置解析、命令解析、事件归一化
2. **集成测试**: 事件总线→教学编排器→mock LLM
3. **CLI 冒烟测试**: spawn 进程验证命令输出
4. **降级测试**: 模拟非 TTY、窄终端、教学失败

## Execution Strategy

### Parallel Execution Waves

**Wave 1: Foundation** (3 tasks, parallel)
- Task 1: Config schema extension
- Task 3: `/teach` command parsing
- Task 4: Install Ink dependencies

**Wave 2: Core Infrastructure** (2 tasks, parallel after Wave 1)
- Task 2: Event bus layer
- Task 5: Teaching stream orchestrator

**Wave 3: UI + Integration** (2 tasks, parallel after Wave 2)
- Task 6: Ink dual-pane UI
- Task 7: Fallback & degradation

**Wave 4: Polish + Verification** (2 tasks, sequential)
- Task 8: Integration wiring
- Task 9: Documentation & final tests

### Dependency Matrix
| Task | Depends On | Blocks |
|------|------------|--------|
| 1. Config | - | 2, 3, 5, 6 |
| 2. Event Bus | 1 | 5, 6, 8 |
| 3. /teach Command | 1 | 8 |
| 4. Ink Deps | - | 6 |
| 5. Teaching Orchestrator | 1, 2 | 6, 8 |
| 6. Ink UI | 2, 4, 5 | 8 |
| 7. Fallback | 1 | 8 |
| 8. Integration | 2, 3, 5, 6, 7 | 9 |
| 9. Docs & Tests | 8 | - |

### Agent Dispatch Summary
| Wave | Tasks | Categories |
|------|-------|------------|
| 1 | 3 | quick, quick, quick |
| 2 | 2 | unspecified-high, unspecified-high |
| 3 | 2 | visual-engineering, quick |
| 4 | 2 | deep, writing |

## TODOs

- [ ] 1. 扩展配置 Schema (Config Schema Extension)

  **What to do**:
  1. 在 `src/config.ts` 的 `SharkCodeConfig` 类型中新增教育模式字段：
     ```typescript
     teaching?: {
       enabled: boolean;           // 默认 false
       model?: string;             // 教学模型，如 "gpt-4o-mini"
       verbosity: '简洁' | '标准' | '详细';  // 默认 '标准'
     }
     ```
  2. 在 `readMultiConfig()` 中添加 teaching 字段的默认值处理
  3. 在 `saveMultiConfig()` 中确保 teaching 字段正确序列化
  4. 导出 `TeachingVerbosity` 类型

  **Must NOT do**:
  - 不添加 `teachingProvider` 字段
  - 不添加 `teachingLanguage` 字段（MVP 固定中文）

  **Recommended Agent Profile**:
  - Category: `quick` — 单文件修改，schema 扩展
  - Skills: `[]` — 无需特殊技能
  - Omitted: `git-master` — 不需要复杂 git 操作

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 3, 5, 6 | Blocked By: none

  **References**:
  - Pattern: `src/config.ts:1-50` — 现有配置类型定义
  - Pattern: `src/config.ts:readMultiConfig` — 配置读取逻辑
  - Pattern: `src/config.ts:saveMultiConfig` — 配置保存逻辑
  - Test: `src/config.test.ts` — 现有配置测试模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test src/config.test.ts` 通过
  - [ ] 新增测试: 无 teaching 配置时 `teachingEnabled === false`
  - [ ] 新增测试: teaching 配置 round-trip 通过 `readMultiConfig()`/`saveMultiConfig()`
  - [ ] 新增测试: 无效 verbosity 值 clamp 到 '标准'

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 默认配置加载
    Tool: Bash
    Steps: bun test src/config.test.ts --reporter=verbose
    Expected: 所有测试通过，包含 teaching 默认值测试
    Evidence: .sisyphus/evidence/task-1-config-default.txt

  Scenario: 配置持久化 round-trip
    Tool: Bash
    Steps: bun test src/config.test.ts -t "teaching"
    Expected: teaching 字段正确保存和读取
    Evidence: .sisyphus/evidence/task-1-config-roundtrip.txt
  ```

  **Commit**: YES | Message: `feat(config): add teaching mode configuration schema` | Files: `src/config.ts`, `src/config.test.ts`

- [ ] 2. 事件总线层 (Agent Event Bus)

  **What to do**:
  1. 新建 `src/agent-events.ts`
  2. 定义统一事件类型（归一化 streamText 和 generateText）：
     ```typescript
     export type AgentEvent =
       | { type: 'text-delta'; delta: string }
       | { type: 'tool-call'; toolName: string; args: unknown }
       | { type: 'tool-result'; toolName: string; result: string }
       | { type: 'tool-error'; toolName: string; error: string }
       | { type: 'thinking-delta'; delta: string }
       | { type: 'step-start'; stepIndex: number }
       | { type: 'step-end'; stepIndex: number }
       | { type: 'run-start' }
       | { type: 'run-end'; interrupted: boolean }
       | { type: 'error'; message: string }
     ```
  3. 实现 `AgentEventBus` 类：
     - `subscribe(listener: (event: AgentEvent) => void): () => void`
     - `emit(event: AgentEvent): void`
     - `clear(): void`
  4. 实现 `normalizeStreamEvent(event: FullStreamPart): AgentEvent | null`
  5. 实现 `normalizeGenerateResult(result: GenerateTextResult): AgentEvent[]`

  **Must NOT do**:
  - 不修改 `src/agent.ts` 的渲染逻辑（在 Task 8 集成）
  - 不在事件总线中做任何 I/O

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — 新架构层，需要仔细设计
  - Skills: `[]`
  - Omitted: `git-master` — 新文件创建

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 5, 6, 8 | Blocked By: 1

  **References**:
  - Pattern: `src/agent.ts:757-944` — 当前 streamText 事件处理
  - Pattern: `src/agent.ts:631-695` — 当前 generateText 处理
  - API: `ai` SDK 的 `FullStreamPart` 类型

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test src/agent-events.test.ts` 通过
  - [ ] streamText 事件正确归一化
  - [ ] generateText 结果正确归一化
  - [ ] 多订阅者正确接收事件
  - [ ] unsubscribe 正确移除监听器

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 事件归一化
    Tool: Bash
    Steps: bun test src/agent-events.test.ts -t "normalize"
    Expected: streamText 和 generateText 事件都正确转换
    Evidence: .sisyphus/evidence/task-2-normalize.txt

  Scenario: 订阅/取消订阅
    Tool: Bash
    Steps: bun test src/agent-events.test.ts -t "subscribe"
    Expected: 订阅者正确接收事件，取消后不再接收
    Evidence: .sisyphus/evidence/task-2-subscribe.txt
  ```

  **Commit**: YES | Message: `feat(events): add renderer-agnostic agent event bus` | Files: `src/agent-events.ts`, `src/agent-events.test.ts`

- [ ] 3. /teach 命令解析 (/teach Command Parsing)

  **What to do**:
  1. 在 `src/cli.ts` 的 `SLASH_COMMANDS` 中添加：
     ```typescript
     { name: '/teach', description: '开启/关闭教育模式' },
     { name: '/teach off', description: '关闭教育模式' },
     { name: '/teach model', description: '设置教学模型' },
     { name: '/teach level', description: '设置教学详略 (简洁/标准/详细)' },
     ```
  2. 在命令处理 switch 中添加 `/teach` 系列命令处理
  3. `/teach` (无参数): 切换教育模式开关
  4. `/teach off`: 关闭教育模式
  5. `/teach model <name>`: 设置教学模型
  6. `/teach level <level>`: 设置教学详略
  7. 所有设置立即持久化到配置文件
  8. 命令执行后打印当前教育模式状态

  **Must NOT do**:
  - 不实现实际的教育模式渲染（在 Task 6, 8）
  - 不修改 REPL 主循环逻辑

  **Recommended Agent Profile**:
  - Category: `quick` — 在现有命令系统中添加新命令
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 8 | Blocked By: 1

  **References**:
  - Pattern: `src/cli.ts:652-663` — SLASH_COMMANDS 定义
  - Pattern: `src/cli.ts:1173-1250` — 现有命令处理
  - Pattern: `src/cli.ts:statusLine` — 状态行格式

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `/teach` 切换 teachingEnabled 状态
  - [ ] `/teach off` 将 teachingEnabled 设为 false
  - [ ] `/teach model gpt-4o-mini` 保存模型配置
  - [ ] `/teach level 详细` 保存详略配置
  - [ ] 无效参数返回确定性错误信息
  - [ ] `bun test src/teach-command.test.ts` 通过

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: /teach 命令解析
    Tool: Bash
    Steps: bun test src/teach-command.test.ts
    Expected: 所有命令正确解析和执行
    Evidence: .sisyphus/evidence/task-3-teach-commands.txt

  Scenario: 无效命令处理
    Tool: Bash
    Steps: bun test src/teach-command.test.ts -t "invalid"
    Expected: 返回确定性错误字符串
    Evidence: .sisyphus/evidence/task-3-invalid-command.txt
  ```

  **Commit**: YES | Message: `feat(cli): add /teach command family` | Files: `src/cli.ts`, `src/teach-command.test.ts`

- [ ] 4. 安装 Ink 依赖 (Install Ink Dependencies)

  **What to do**:
  1. 安装 Ink 及相关依赖：
     ```bash
     bun add ink react
     bun add -d @types/react
     ```
  2. 更新 `tsconfig.json` 添加 JSX 支持：
     ```json
     {
       "compilerOptions": {
         "jsx": "react-jsx"
       }
     }
     ```
  3. 验证构建成功

  **Must NOT do**:
  - 不创建任何 UI 组件（在 Task 6）
  - 不修改现有代码逻辑

  **Recommended Agent Profile**:
  - Category: `quick` — 依赖安装和配置
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6 | Blocked By: none

  **References**:
  - External: `https://github.com/vadimdemedes/ink` — Ink 官方文档
  - Pattern: `package.json` — 现有依赖
  - Pattern: `tsconfig.json` — 现有 TypeScript 配置

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun add ink react @types/react` 成功
  - [ ] `bun run build` 成功
  - [ ] `import { render, Box, Text } from 'ink'` 不报错

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 依赖安装验证
    Tool: Bash
    Steps: bun run build && node -e "require('ink')"
    Expected: 无错误输出
    Evidence: .sisyphus/evidence/task-4-ink-install.txt

  Scenario: JSX 编译验证
    Tool: Bash
    Steps: echo "import {Box} from 'ink'; const x = <Box/>" > /tmp/test.tsx && bunx tsc --noEmit /tmp/test.tsx
    Expected: 无编译错误
    Evidence: .sisyphus/evidence/task-4-jsx-compile.txt
  ```

  **Commit**: YES | Message: `chore(deps): add ink and react for educational UI` | Files: `package.json`, `bun.lockb`, `tsconfig.json`

- [ ] 5. 教学流编排器 (Teaching Stream Orchestrator)

  **What to do**:
  1. 新建 `src/teaching.ts`
  2. 定义教学事件类型：
     ```typescript
     export type TeachingEvent =
       | { type: 'teaching-start' }
       | { type: 'teaching-delta'; delta: string }
       | { type: 'teaching-end' }
       | { type: 'teaching-error'; message: string }
     ```
  3. 实现 `TeachingOrchestrator` 类：
     - 订阅 AgentEventBus
     - 收集事件上下文
     - 触发并行教学 LLM 调用
     - 发出 TeachingEvent
  4. 实现教学 prompt 构建：
     - 根据 verbosity 调整详略
     - 固定中文输出
     - 包含用户问题、工具调用、结果摘要
  5. 实现错误处理：
     - 网络/限流/认证错误 → `teaching-error` 事件
     - 不阻塞主执行

  **Must NOT do**:
  - 不做 shell 输出实时教学
  - 不做教学历史/回放

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — 核心业务逻辑，并发流处理
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 6, 8 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/agent.ts:streamText` — LLM 调用模式
  - Pattern: `src/provider.ts` — provider 获取
  - API: `ai` SDK 的 `streamText` API

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test src/teaching.test.ts` 通过
  - [ ] 教学流失败不影响主执行
  - [ ] 单次 abort signal 同时停止主流和教学流
  - [ ] generateText 路径也能触发教学事件
  - [ ] streamText 路径也能触发教学事件

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 教学流正常运行
    Tool: Bash
    Steps: bun test src/teaching.test.ts -t "orchestrator"
    Expected: 收到 teaching-start, teaching-delta*, teaching-end 事件
    Evidence: .sisyphus/evidence/task-5-orchestrator.txt

  Scenario: 教学流失败降级
    Tool: Bash
    Steps: bun test src/teaching.test.ts -t "error"
    Expected: 收到 teaching-error 事件，主流不受影响
    Evidence: .sisyphus/evidence/task-5-error-handling.txt

  Scenario: abort 信号传播
    Tool: Bash
    Steps: bun test src/teaching.test.ts -t "abort"
    Expected: 两个流都正确中止
    Evidence: .sisyphus/evidence/task-5-abort.txt
  ```

  **Commit**: YES | Message: `feat(teaching): add parallel teaching stream orchestrator` | Files: `src/teaching.ts`, `src/teaching.test.ts`

- [ ] 6. Ink 双栏 UI (Ink Dual-Pane UI)

  **What to do**:
  1. 新建 `src/ui/EducationalApp.tsx` — Ink 应用入口
  2. 新建 `src/ui/ExecutionPane.tsx` — 左栏执行流
  3. 新建 `src/ui/TeachingPane.tsx` — 右栏教学流
  4. 实现布局：
     ```tsx
     <Box flexDirection="row" width="100%">
       <Box width="50%" borderStyle="single">
         <ExecutionPane events={agentEvents} />
       </Box>
       <Box width="50%" borderStyle="single">
         <TeachingPane events={teachingEvents} />
       </Box>
     </Box>
     ```
  5. ExecutionPane 渲染：
     - text-delta → 追加文本
     - tool-call → 显示工具调用
     - tool-result → 显示结果摘要
     - thinking → 显示思考过程
  6. TeachingPane 渲染：
     - teaching-delta → 追加教学文本
     - teaching-error → 显示「教学讲解暂时不可用」
  7. 实现 `renderEducationalApp(eventBus, teachingOrchestrator)` 入口函数

  **Must NOT do**:
  - 不实现独立滚动（MVP 用简单自动滚动到底部）
  - 不修改普通 REPL 渲染

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — UI 组件开发
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 8 | Blocked By: 2, 4, 5

  **References**:
  - External: `https://github.com/vadimdemedes/ink` — Ink 组件 API
  - Pattern: `src/agent.ts:18-29` — TOOL_LABELS 工具图标
  - Pattern: `src/agent.ts:772-833` — 现有工具渲染逻辑

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test src/ui/EducationalApp.test.tsx` 通过
  - [ ] 左栏正确渲染 agent 事件
  - [ ] 右栏正确渲染教学事件
  - [ ] 右栏错误时显示降级提示「教学讲解暂时不可用」
  - [ ] 组件不报 React 警告

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 左栏渲染
    Tool: Bash
    Steps: bun test src/ui/EducationalApp.test.tsx -t "ExecutionPane"
    Expected: agent 事件正确渲染
    Evidence: .sisyphus/evidence/task-6-execution-pane.txt

  Scenario: 右栏渲染
    Tool: Bash
    Steps: bun test src/ui/EducationalApp.test.tsx -t "TeachingPane"
    Expected: 教学事件正确渲染，错误显示降级提示
    Evidence: .sisyphus/evidence/task-6-teaching-pane.txt
  ```

  **Commit**: YES | Message: `feat(ui): add Ink dual-pane educational UI` | Files: `src/ui/EducationalApp.tsx`, `src/ui/ExecutionPane.tsx`, `src/ui/TeachingPane.tsx`, `src/ui/EducationalApp.test.tsx`

- [ ] 7. 降级与回退处理 (Fallback & Degradation)

  **What to do**:
  1. 新建 `src/teaching-fallback.ts`
  2. 实现 `canUseEducationalMode()`:
     - 检查 `process.stdout.isTTY`
     - 检查 `process.stdout.columns >= 100`
     - 检查 teachingEnabled
     - 返回 `{ canUse: boolean; reason?: string }`
  3. 实现 `printFallbackNotice(reason: string)`:
     - 输出提示信息并继续普通模式
  4. 在 `src/cli.ts` 中集成：
     - REPL 启动时检查
     - `/teach` 开启时检查

  **Must NOT do**:
  - 不在单次运行模式启用教育模式

  **Recommended Agent Profile**:
  - Category: `quick` — 简单条件检查
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 8 | Blocked By: 1

  **References**:
  - Pattern: `src/cli.ts:1138-1140` — 现有 TTY 检查
  - Pattern: `src/agent.ts:34` — process.stdout.columns 使用

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test src/teaching-fallback.test.ts` 通过
  - [ ] 非 TTY 时返回 `canUse: false` 并说明原因
  - [ ] 终端宽度 < 100 时返回 `canUse: false` 并说明原因
  - [ ] teachingEnabled = false 时返回 `canUse: false`

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: TTY 检查
    Tool: Bash
    Steps: bun test src/teaching-fallback.test.ts -t "TTY"
    Expected: 非 TTY 正确检测
    Evidence: .sisyphus/evidence/task-7-tty-check.txt

  Scenario: 宽度检查
    Tool: Bash
    Steps: bun test src/teaching-fallback.test.ts -t "width"
    Expected: 窄终端正确检测
    Evidence: .sisyphus/evidence/task-7-width-check.txt
  ```

  **Commit**: YES | Message: `feat(teaching): add fallback detection for educational mode` | Files: `src/teaching-fallback.ts`, `src/teaching-fallback.test.ts`

- [ ] 8. 集成接入 (Integration Wiring)

  **What to do**:
  1. 修改 `src/agent.ts`：
     - 在 `runAgent()` 中创建 AgentEventBus 实例
     - 在事件循环中调用 `eventBus.emit(normalizeStreamEvent(event))`
     - 在 generateText 路径中调用 `normalizeGenerateResult().forEach(e => eventBus.emit(e))`
     - 保持现有 stdout 渲染逻辑不变
  2. 修改 `src/cli.ts`：
     - 在 REPL 启动时检查 `canUseEducationalMode()`
     - 如果教育模式启用且可用，切换到 Ink 渲染
     - 如果不可用，打印降级提示并继续普通模式
  3. 创建教学流：
     - 实例化 TeachingOrchestrator
     - 连接到 eventBus
     - 传递给 EducationalApp
  4. 确保中断处理：
     - Esc 中断在教育模式下正常工作
     - 权限提示在教育模式下正常工作（可能需要临时退出 Ink）

  **Must NOT do**:
  - 不破坏普通 REPL 模式
  - 不在教育模式下修改 agent 核心逻辑

  **Recommended Agent Profile**:
  - Category: `deep` — 需要仔细理解多个模块的交互
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: 9 | Blocked By: 2, 3, 5, 6, 7

  **References**:
  - Pattern: `src/cli.ts:1124-1358` — REPL 主循环
  - Pattern: `src/agent.ts:598-1015` — agent 执行流
  - Pattern: `src/interrupt.ts:25-72` — 中断控制器
  - Pattern: `src/permission.ts:24-85` — 权限 UI

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test` 全部通过
  - [ ] 普通模式行为不变
  - [ ] 教育模式下显示双栏 UI
  - [ ] Esc 中断正常工作
  - [ ] 权限提示正常工作
  - [ ] generateText 路径在教育模式下正常工作

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 普通模式不受影响
    Tool: Bash
    Steps: node dist/cli.mjs --help
    Expected: 正常输出帮助信息
    Evidence: .sisyphus/evidence/task-8-normal-mode.txt

  Scenario: 集成测试
    Tool: Bash
    Steps: bun test src/integration.test.ts
    Expected: 事件正确从 agent 流向 UI
    Evidence: .sisyphus/evidence/task-8-integration.txt
  ```

  **Commit**: YES | Message: `feat(teaching): integrate educational mode into CLI` | Files: `src/agent.ts`, `src/cli.ts`, `src/integration.test.ts`

- [ ] 9. 文档与最终测试 (Documentation & Final Tests)

  **What to do**:
  1. 更新 `README.md`：
     - 添加教育模式章节
     - 说明 `/teach` 命令用法
     - 说明配置选项
  2. 确保所有测试通过：
     - `bun test` 全部通过
     - 无 TypeScript 警告
  3. 补充边界测试：
     - 终端 resize 处理
     - 多次 `/teach` 切换
     - 配置文件损坏恢复

  **Must NOT do**:
  - 不添加不必要的文档
  - 不创建独立的 TEACH.md 文档

  **Recommended Agent Profile**:
  - Category: `writing` — 文档编写
  - Skills: `[]`
  - Omitted: -

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: none | Blocked By: 8

  **References**:
  - Pattern: `README.md` — 现有文档格式
  - Test: `src/*.test.ts` — 现有测试模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run build` 成功
  - [ ] `bun test` 全部通过
  - [ ] README.md 包含教育模式说明
  - [ ] `/teach` 在 --help 输出中可见

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 文档完整性
    Tool: Bash
    Steps: grep -c "/teach" README.md
    Expected: 至少 3 处提及
    Evidence: .sisyphus/evidence/task-9-docs.txt

  Scenario: 全量测试
    Tool: Bash
    Steps: bun test --reporter=verbose
    Expected: 所有测试通过
    Evidence: .sisyphus/evidence/task-9-all-tests.txt
  ```

  **Commit**: YES | Message: `docs: add educational mode documentation` | Files: `README.md`

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
  - 验证所有 TODO 任务完成
  - 验证所有验收标准通过
  - 验证无遗漏需求

- [ ] F2. Code Quality Review — unspecified-high
  - 代码风格一致性
  - 无 TypeScript 错误/警告
  - 无明显性能问题

- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
  - 在真实终端测试教育模式
  - 测试所有 /teach 命令
  - 测试降级场景

- [ ] F4. Scope Fidelity Check — deep
  - 确认未引入 scope creep
  - 确认 guardrails 被遵守
  - 确认普通模式不受影响

## Commit Strategy
- 每个 Task 完成后单独 commit
- commit 消息格式: `type(scope): description`
- 在 Wave 结束时可考虑 squash

## Success Criteria
1. `/teach` 在交互模式下可开启全屏双栏教育 UI
2. 左栏显示 agent 执行流程（与普通模式一致）
3. 右栏显示中文教学讲解（并行 LLM 生成）
4. `/teach off` 可返回普通 CLI 模式
5. 教学详略三档可调
6. 教学模型用户可配置
7. 教学失败时主执行继续，右栏显示降级提示
8. 非 TTY/窄终端自动降级到普通模式
9. 所有测试通过
10. 普通 CLI 模式不受任何影响
