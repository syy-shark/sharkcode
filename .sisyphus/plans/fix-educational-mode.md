# 修复教育模式 TUI 体验问题

## TL;DR
> **Summary**: 修复 SharkCode 教育模式的 3 个核心问题：左栏实时展示不佳、输出排版碎片化、右栏教学内容不显示
> **Deliverables**: 修复后的 `EducationalApp.tsx`、`ExecutionPane.tsx`、`TeachingPane.tsx`、`cli.ts`，配套单元测试
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 (生命周期) → Task 2-4 (UI 组件) → Task 5 (集成测试)

## Context

### Original Request
用户反馈教育模式体验问题：
1. 做项目时一直显示"思考中"，但实际在做事的过程看不到
2. 做完后一口气全输出，排版非常不好
3. 右边的教学讲解没反应

### Interview Summary
通过代码分析发现根因：
- **右栏无内容**：`EducationalApp.tsx` 在 `run-end` 时立即 `exit()`，但教学生成在 `cli.ts` 的 `run-end` 之后才触发，UI 已死
- **双重退出竞争**：`EducationalApp.tsx:24-29` 和 `cli.ts:1539-1546` 都有退出逻辑，存在竞争
- **输出碎片化**：`ExecutionPane.tsx` 和 `TeachingPane.tsx` 对每个 `delta` 事件单独渲染 `<Text>`，导致排版混乱
- **缺少状态指示**：没有"当前正在执行哪个工具"的聚合状态显示

### Metis Review (gaps addressed)
- **关键遗漏**：`cli.ts` 的 `finally` 块会无条件 unmount `educationalApp`，仅修复 `EducationalApp.tsx` 不够
- **空白面板**：即使不提前退出，`teaching-start`/`teaching-end` 渲染 `null`，无 delta 时右栏仍空
- **需明确退出策略**：auto-exit after teaching completes/errors vs "Press any key to exit"
- **测试覆盖不足**：现有测试只检查 headers，无生命周期/超时/聚合回归测试

## Work Objectives

### Core Objective
修复教育模式 TUI，使其能够：
1. 实时展示 agent 执行过程（工具调用状态、文本输出）
2. 流式文本聚合显示，避免碎片化排版
3. 正确显示教学内容，等待教学完成后再退出

### Deliverables
- [ ] 修复后的 `src/ui/EducationalApp.tsx` — 单一退出所有者，等待教学完成
- [ ] 修复后的 `src/ui/ExecutionPane.tsx` — 文本聚合、工具状态显示
- [ ] 修复后的 `src/ui/TeachingPane.tsx` — 明确的等待/生成/空/错误状态
- [ ] 修复后的 `src/cli.ts` — 移除 finally 中的无条件 unmount
- [ ] 新增/扩展测试文件覆盖生命周期、聚合、超时场景

### Definition of Done (verifiable conditions with commands)
- `bun test src/ui/EducationalApp.test.tsx` 通过，包含生命周期测试
- `bun test` 全部通过，exit code 0
- 手动验证：`bun run start` → `/teach on` → 输入任务 → 左栏实时显示工具调用 → 右栏显示教学内容 → 教学完成后自动退出

### Must Have
- 单一退出所有者（`EducationalApp` 控制退出时机）
- 连续 `text-delta` 聚合为单个文本块
- 连续 `teaching-delta` 聚合为单个文本块
- 工具状态显示："正在执行 X 工具"
- 教学面板明确状态：等待中 / 生成中 / 已完成 / 出错 / 无内容
- 超时机制：`run-end` 后 30 秒无 `teaching-end` 则自动退出
- 可注入超时值用于测试

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不改造为"并行实时教学"模式（保持 post-completion 设计）
- 不添加"Press any key to exit"交互（自动退出）
- 不重新设计 event contract（保持现有 `src/agent-events.ts`）
- 不添加 transcript 持久化功能
- 不添加语法高亮功能

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- **Test decision**: tests-after + `ink-testing-library` + `bun test`
- **QA policy**: Every task has agent-executed scenarios
- **Evidence**: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

**Wave 1: Foundation (生命周期修复)**
- Task 1: 统一退出控制 (`EducationalApp.tsx` + `cli.ts`)

**Wave 2: UI 组件优化 (可并行)**
- Task 2: ExecutionPane 文本聚合 + 工具状态
- Task 3: TeachingPane 状态机 + 文本聚合
- Task 4: 超时机制

**Wave 3: 集成验证**
- Task 5: 集成测试 + 端到端验证

### Dependency Matrix
| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 2, 3, 4, 5 |
| 2 | 1 | 5 |
| 3 | 1 | 5 |
| 4 | 1 | 5 |
| 5 | 2, 3, 4 | - |

### Agent Dispatch Summary
| Wave | Tasks | Categories |
|------|-------|------------|
| 1 | 1 | deep |
| 2 | 3 | visual-engineering |
| 3 | 1 | unspecified-high |

## TODOs

- [ ] 1. 统一退出控制：修复双重退出竞争

  **What to do**:
  1. 修改 `src/ui/EducationalApp.tsx`:
     - 移除 `run-end` 时的立即 `exit()` 调用
     - 改为监听 `teaching-end` 或 `teaching-error` 事件后再退出
     - 添加 `teachingComplete` 和 `runComplete` 状态
     - 退出条件：`runComplete && teachingComplete`
  2. 修改 `src/cli.ts`:
     - 在 `finally` 块中，不要无条件 unmount `educationalApp`
     - 改为：让 `EducationalApp` 自行控制退出时机
     - 移除或延迟 `educationalApp.unmount()` 调用
  3. 确保 `onExit` 回调在正确时机被调用

  **Must NOT do**:
  - 不要添加新的退出触发点
  - 不要修改 `eventBus` 或 `teachingOrchestrator` 的接口

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: 涉及多文件协调的生命周期逻辑，需要深入理解
  - Skills: [] — 无需额外技能
  - Omitted: [`playwright`] — 非浏览器任务

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5 | Blocked By: -

  **References**:
  - Pattern: `src/ui/EducationalApp.tsx:23-40` — 当前退出逻辑，需修改
  - Pattern: `src/cli.ts:1539-1546` — finally 块 unmount 逻辑，需修改
  - API/Type: `src/teaching.ts:TeachingEvent` — 教学事件类型
  - API/Type: `src/agent-events.ts:AgentEvent` — agent 事件类型

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalApp.test.tsx` 包含并通过：`run-end` 后 UI 不立即退出
  - [ ] `bun test src/ui/EducationalApp.test.tsx` 包含并通过：`teaching-end` 后 UI 正确退出
  - [ ] `bun test` exit code 0

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 正常流程 - run-end 后等待 teaching-end
    Tool: Bash (bun test)
    Steps: 
      1. 创建测试：emit run-end → 等待 100ms → assert app 未退出
      2. emit teaching-end → 等待 100ms → assert app 已退出
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-1-lifecycle.txt

  Scenario: teaching-error 后退出
    Tool: Bash (bun test)
    Steps:
      1. 创建测试：emit run-end → emit teaching-error
      2. 等待 100ms → assert app 已退出
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-1-error-exit.txt
  ```

  **Commit**: YES | Message: `fix(edu): unify exit control, wait for teaching completion` | Files: `src/ui/EducationalApp.tsx`, `src/cli.ts`, `src/ui/EducationalApp.test.tsx`

---

- [ ] 2. ExecutionPane 文本聚合 + 工具状态显示

  **What to do**:
  1. 修改 `src/ui/ExecutionPane.tsx`:
     - 实现连续 `text-delta` 事件的聚合逻辑
     - 将多个连续 `text-delta` 合并为单个 `<Text>` 组件
     - 添加"当前工具状态"显示：
       - `tool-call` 到来时显示 "🔧 正在执行: {toolName}..."
       - `tool-result` 或 `tool-error` 到来时移除该状态
     - 改进 `thinking-delta` 显示：聚合为单个思考块
  2. 创建聚合辅助函数 `aggregateEvents(events: AgentEvent[])`
  3. 更新渲染逻辑使用聚合后的事件

  **Must NOT do**:
  - 不要修改 `AgentEvent` 类型定义
  - 不要修改事件发射逻辑

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UI 组件优化，关注视觉呈现
  - Skills: [] — 无需额外技能
  - Omitted: [`playwright`] — 非浏览器测试

  **Parallelization**: Can Parallel: YES (与 Task 3, 4) | Wave 2 | Blocks: 5 | Blocked By: 1

  **References**:
  - Pattern: `src/ui/ExecutionPane.tsx:17-64` — 当前渲染逻辑，需重构
  - API/Type: `src/agent-events.ts:AgentEvent` — 事件类型定义
  - Test: `src/ui/ExecutionPane.test.tsx` — 如存在，遵循其模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] 连续 `text-delta:"Hel"`, `text-delta:"lo"` 渲染为 `Hello` 而非两行
  - [ ] `tool-call` 后显示"正在执行"状态
  - [ ] `tool-result` 后"正在执行"状态消失
  - [ ] `bun test` exit code 0

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 文本聚合
    Tool: Bash (bun test)
    Steps:
      1. 创建测试：渲染 ExecutionPane，传入 [text-delta:"Hel", text-delta:"lo", text-delta:" World"]
      2. assert 渲染输出包含 "Hello World" 作为连续文本
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-2-aggregation.txt

  Scenario: 工具状态显示
    Tool: Bash (bun test)
    Steps:
      1. 渲染 ExecutionPane，传入 [tool-call:{toolName:"read_file"}]
      2. assert 显示 "正在执行: read_file"
      3. 追加 tool-result 事件
      4. assert "正在执行" 状态消失
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-2-tool-status.txt
  ```

  **Commit**: YES | Message: `feat(edu): aggregate text deltas and show tool status in ExecutionPane` | Files: `src/ui/ExecutionPane.tsx`, `src/ui/ExecutionPane.test.tsx`

---

- [ ] 3. TeachingPane 状态机 + 文本聚合

  **What to do**:
  1. 修改 `src/ui/TeachingPane.tsx`:
     - 实现明确的状态机：`waiting` → `generating` → `done` | `error` | `empty`
     - 状态显示：
       - `waiting`: "等待 Agent 执行完成..."
       - `generating`: "📝 正在生成教学内容..." + 流式文本
       - `done`: 显示完整教学内容
       - `error`: "教学讲解暂时不可用"
       - `empty`: "本次执行无需特别讲解"（teaching-end 但无 delta）
     - 实现连续 `teaching-delta` 聚合为单个文本块
  2. 添加状态推导逻辑：
     - 初始状态：`waiting`
     - 收到 `teaching-start`：`generating`
     - 收到 `teaching-delta`：保持 `generating`，累积文本
     - 收到 `teaching-end`：如有文本则 `done`，否则 `empty`
     - 收到 `teaching-error`：`error`

  **Must NOT do**:
  - 不要修改 `TeachingEvent` 类型定义
  - 不要修改 `TeachingOrchestrator`

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UI 组件状态机实现
  - Skills: [] — 无需额外技能
  - Omitted: [`playwright`] — 非浏览器测试

  **Parallelization**: Can Parallel: YES (与 Task 2, 4) | Wave 2 | Blocks: 5 | Blocked By: 1

  **References**:
  - Pattern: `src/ui/TeachingPane.tsx:8-47` — 当前渲染逻辑，需重构
  - API/Type: `src/teaching.ts:TeachingEvent` — 教学事件类型
  - Test: `src/ui/TeachingPane.test.tsx` — 如存在，遵循其模式

  **Acceptance Criteria** (agent-executable only):
  - [ ] 初始状态显示 "等待 Agent 执行完成..."
  - [ ] `teaching-start` 后显示 "正在生成教学内容..."
  - [ ] 连续 `teaching-delta:"第"`, `teaching-delta:"一段"` 渲染为 `第一段`
  - [ ] `teaching-end` 且无 delta 时显示 "本次执行无需特别讲解"
  - [ ] `bun test` exit code 0

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 状态机流转
    Tool: Bash (bun test)
    Steps:
      1. 创建测试：渲染 TeachingPane，传入 []
      2. assert 显示 "等待"
      3. 传入 [teaching-start]
      4. assert 显示 "正在生成"
      5. 传入 [teaching-start, teaching-delta:"内容"]
      6. assert 显示 "内容"
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-3-state-machine.txt

  Scenario: 空内容处理
    Tool: Bash (bun test)
    Steps:
      1. 渲染 TeachingPane，传入 [teaching-start, teaching-end]
      2. assert 显示 "无需特别讲解"
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-3-empty-state.txt
  ```

  **Commit**: YES | Message: `feat(edu): implement state machine and text aggregation in TeachingPane` | Files: `src/ui/TeachingPane.tsx`, `src/ui/TeachingPane.test.tsx`

---

- [ ] 4. 超时机制

  **What to do**:
  1. 修改 `src/ui/EducationalApp.tsx`:
     - 添加超时逻辑：`run-end` 后启动 30 秒计时器
     - 如果 30 秒内未收到 `teaching-end` 或 `teaching-error`，自动退出
     - 超时值应可配置（通过 props 或环境变量），便于测试
  2. 添加超时状态显示：
     - 超时退出前，右栏显示 "教学生成超时，正在退出..."
  3. 确保计时器在组件卸载时清理

  **Must NOT do**:
  - 不要硬编码超时值（应可注入）
  - 不要在超时时 crash

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: UI 组件超时逻辑
  - Skills: [] — 无需额外技能
  - Omitted: [`playwright`] — 非浏览器测试

  **Parallelization**: Can Parallel: YES (与 Task 2, 3) | Wave 2 | Blocks: 5 | Blocked By: 1

  **References**:
  - Pattern: `src/ui/EducationalApp.tsx:23-40` — 需添加超时逻辑
  - Test: `src/ui/EducationalApp.test.tsx` — 需添加超时测试

  **Acceptance Criteria** (agent-executable only):
  - [ ] `run-end` 后无 teaching 事件，30 秒后自动退出
  - [ ] 超时值可通过 props 配置（测试用）
  - [ ] 组件卸载时计时器被清理
  - [ ] `bun test` exit code 0

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 超时退出
    Tool: Bash (bun test)
    Steps:
      1. 创建测试：渲染 EducationalApp，配置 timeout=100ms
      2. emit run-end
      3. 等待 150ms
      4. assert app 已退出
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-4-timeout.txt

  Scenario: 超时前收到 teaching-end
    Tool: Bash (bun test)
    Steps:
      1. 渲染 EducationalApp，配置 timeout=1000ms
      2. emit run-end
      3. 等待 50ms → emit teaching-end
      4. assert app 已退出（因 teaching-end，非超时）
    Expected: 测试通过
    Evidence: .sisyphus/evidence/task-4-no-timeout.txt
  ```

  **Commit**: YES | Message: `feat(edu): add configurable timeout for teaching completion` | Files: `src/ui/EducationalApp.tsx`, `src/ui/EducationalApp.test.tsx`

---

- [ ] 5. 集成测试 + 端到端验证

  **What to do**:
  1. 创建/扩展 `src/ui/EducationalApp.test.tsx`:
     - 完整生命周期测试：run-start → tool-call → tool-result → text-delta → run-end → teaching-start → teaching-delta → teaching-end → exit
     - 验证左栏和右栏都正确渲染
  2. 运行完整测试套件：
     - `bun test` 确保所有测试通过
  3. 手动验证（作为 evidence 记录）：
     - 启动 `bun run start`
     - 执行 `/teach on`
     - 输入一个简单任务
     - 截图/录制左右栏的实时展示

  **Must NOT do**:
  - 不要跳过任何失败的测试
  - 不要引入新的 lint 错误

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: 需要综合验证多个组件
  - Skills: [`playwright`] — 可选，用于端到端截图
  - Omitted: [] — 

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: - | Blocked By: 2, 3, 4

  **References**:
  - Test: `src/ui/EducationalApp.test.tsx` — 主测试文件
  - Test: `src/ui/ExecutionPane.test.tsx` — 左栏测试
  - Test: `src/ui/TeachingPane.test.tsx` — 右栏测试

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test` 全部通过，exit code 0
  - [ ] `bun run build` 成功（如有）
  - [ ] 无 TypeScript 错误：`bunx tsc --noEmit` exit code 0

  **QA Scenarios** (MANDATORY):
  ```
  Scenario: 完整生命周期
    Tool: Bash (bun test)
    Steps:
      1. 运行 `bun test src/ui/EducationalApp.test.tsx`
      2. 检查所有测试通过
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-5-full-test.txt

  Scenario: 全量测试
    Tool: Bash
    Steps:
      1. 运行 `bun test`
      2. 检查 exit code
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-5-all-tests.txt

  Scenario: TypeScript 类型检查
    Tool: Bash
    Steps:
      1. 运行 `bunx tsc --noEmit`
      2. 检查 exit code
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-5-typecheck.txt
  ```

  **Commit**: YES | Message: `test(edu): add comprehensive integration tests for educational mode` | Files: `src/ui/EducationalApp.test.tsx`

---

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
  - 验证所有 TODO 都按计划完成
  - 验证无遗漏的 acceptance criteria

- [ ] F2. Code Quality Review — unspecified-high
  - 检查代码风格一致性
  - 检查无 TypeScript 错误
  - 检查无明显的 bug

- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
  - 实际运行 `sharkcode`
  - 测试教育模式完整流程
  - 截图记录

- [ ] F4. Scope Fidelity Check — deep
  - 验证未超出计划范围
  - 验证未引入计划外功能

## Commit Strategy
每个 TODO 完成后单独提交，使用指定的 commit message 格式。

## Success Criteria
1. 教育模式启用后，左栏实时显示 agent 执行过程（工具调用、文本输出）
2. 文本输出聚合显示，无碎片化
3. 右栏正确显示教学内容，有明确的状态指示
4. 教学完成后自动退出，超时有保护机制
5. 所有测试通过：`bun test` exit code 0
