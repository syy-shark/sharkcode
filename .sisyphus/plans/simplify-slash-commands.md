# 简化斜杠命令菜单

## TL;DR
> **Summary**: 移除重复的 `/key`、`/login`、`/logout` 命令，简化 `/model` 直接切换当前 provider 模型
> **Deliverables**: 精简的指令菜单，更流畅的用户体验
> **Effort**: Quick
> **Parallel**: NO
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

## Context
### Original Request
用户希望简化指令菜单，去掉和 `/provider` 重复的功能（`/key`、`/login`、`/logout`），并让 `/model` 直接切换当前 provider 的模型。

### Interview Summary
- 移除 `/key`、`/login`、`/logout`（这些功能已包含在 `/provider` 流程中）
- `/model` 应直接显示当前 provider 的模型列表供选择
- `/thinking` 同理，直接调整当前 provider/model 的思考水平

## Work Objectives
### Core Objective
简化斜杠命令菜单，移除冗余命令，提升用户体验

### Deliverables
- 精简的 `SLASH_COMMANDS` 数组
- 独立的 `/model` 快速切换功能
- 更新的帮助信息

### Definition of Done
- [ ] 运行 `bun run start`，输入 `/`，不再显示 `/key`、`/login`、`/logout`
- [ ] 输入 `/model` 直接显示当前 provider 的模型列表
- [ ] `/help` 帮助信息已更新

### Must Have
- 移除 `/key`、`/login`、`/logout` 命令
- `/model` 直接切换模型（不进入完整 provider 设置流程）

### Must NOT Have
- 不要破坏 `/provider` 中的登录/API Key 设置功能
- 不要移除任何核心功能，只是简化入口

## Verification Strategy
- Test decision: 手动测试
- QA policy: 验证所有命令仍然正常工作

## Execution Strategy
### Parallel Execution Waves
Wave 1: [Task 1] 基础清理
Wave 2: [Task 2] 新增 showModelSwitchFlow 函数
Wave 3: [Task 3, Task 4] 更新 REPL 和帮助

### Dependency Matrix
- Task 1: 无依赖
- Task 2: 无依赖
- Task 3: 依赖 Task 1, Task 2
- Task 4: 依赖 Task 3

## TODOs

- [ ] 1. 从 SLASH_COMMANDS 移除冗余命令

  **What to do**:
  编辑 `src/cli.ts` 第 657-672 行的 `SLASH_COMMANDS` 数组，移除以下条目：
  - `{ name: "/key", ... }`
  - `{ name: "/login", ... }`
  - `{ name: "/logout", ... }`
  
  同时简化描述文字：
  - `/thinking` 描述改为 `"调整思考水平"`
  - `/teach model` 描述改为 `"设置教学模型"`
  - `/teach level` 描述改为 `"设置教学详略（简洁/标准/详细）"`

  **Must NOT do**: 不要移除其他命令

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: `[]`

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [3] | Blocked By: []

  **References**:
  - File: `src/cli.ts:657-672` - SLASH_COMMANDS 数组定义

  **Acceptance Criteria**:
  - [ ] SLASH_COMMANDS 数组中不再包含 /key、/login、/logout

  **QA Scenarios**:
  ```
  Scenario: 验证命令列表
    Tool: Bash
    Steps: grep -n '"/key"\|"/login"\|"/logout"' src/cli.ts
    Expected: 无匹配结果（在 SLASH_COMMANDS 数组区域）
  ```

  **Commit**: YES | Message: `refactor(cli): remove redundant /key, /login, /logout commands` | Files: [src/cli.ts]

---

- [ ] 2. 创建独立的 showModelSwitchFlow 函数

  **What to do**:
  在 `src/cli.ts` 中 `showThinkingSetupFlow` 函数附近（约第 205 行后），添加新函数：

  ```typescript
  // ─── Quick model switch (for /model command) ───────────────────────────────
  async function showModelSwitchFlow(multiConfig: MultiConfig): Promise<SlashResult> {
    const providerName = multiConfig.activeProvider;
    const providerLabel = PROVIDERS[providerName]?.label ?? providerName;
    const currentEntry = multiConfig.providers[providerName];
    const currentModel = currentEntry?.model ?? PROVIDERS[providerName]?.defaultModel ?? "";

    console.log(GRAY(`\n  当前 Provider: ${providerLabel}\n`));

    try {
      const newModel = await promptForModelSelection(providerName, currentModel);
      
      if (newModel === currentModel) {
        console.log(GRAY("\n  模型未更改\n"));
        return { multiConfig, config: resolveConfig(multiConfig) };
      }

      const updated: MultiConfig = {
        ...multiConfig,
        providers: {
          ...multiConfig.providers,
          [providerName]: {
            ...(multiConfig.providers[providerName] ?? {}),
            key: multiConfig.providers[providerName]?.key ?? "",
            model: newModel,
          },
        },
      };

      saveMultiConfig(updated);
      const config = resolveConfig(updated);
      console.log(GREEN(`\n  ✓ 模型已切换为 ${newModel}\n`));
      return { multiConfig: updated, config };
    } catch {
      console.log(GRAY("\n  取消\n"));
      return { multiConfig, config: resolveConfig(multiConfig) };
    }
  }
  ```

  **Must NOT do**: 不要修改现有的 `showSetupFlow` 函数

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: `[]`

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [3] | Blocked By: []

  **References**:
  - Pattern: `src/cli.ts:205-259` - showThinkingSetupFlow 函数结构
  - API: `src/cli.ts:341-393` - promptForModelSelection 函数

  **Acceptance Criteria**:
  - [ ] showModelSwitchFlow 函数存在且编译通过
  - [ ] 函数只切换模型，不触发 API Key 或其他设置流程

  **QA Scenarios**:
  ```
  Scenario: 编译检查
    Tool: Bash
    Steps: cd src && bun build cli.ts --no-bundle 2>&1 | head -20
    Expected: 无编译错误
  ```

  **Commit**: YES | Message: `feat(cli): add showModelSwitchFlow for quick model switching` | Files: [src/cli.ts]

---

- [ ] 3. 更新 REPL 中的命令处理

  **What to do**:
  
  **3a. 修改 /model 和 /key 的处理逻辑**（约第 1289-1304 行）
  
  找到这段代码：
  ```typescript
  if (
    trimmed === "/provider" || trimmed.startsWith("/provider ") ||
    trimmed === "/model"    || trimmed.startsWith("/model ")    ||
    trimmed === "/key"      || trimmed.startsWith("/key ")      ||
    trimmed === "/thinking" || trimmed.startsWith("/thinking ")
  ) {
    const r = trimmed === "/thinking" || trimmed.startsWith("/thinking ")
      ? await showThinkingSetupFlow(multiConfig)
      : await showSetupFlow(multiConfig);
  ```
  
  替换为：
  ```typescript
  if (trimmed === "/provider" || trimmed.startsWith("/provider ")) {
    const r = await showSetupFlow(multiConfig);
    multiConfig = r.multiConfig; config = r.config;
    if (r.exit) break;
    try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    console.log(statusLine(config));
    continue;
  }

  if (trimmed === "/model" || trimmed.startsWith("/model ")) {
    const r = await showModelSwitchFlow(multiConfig);
    multiConfig = r.multiConfig; config = r.config;
    try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    console.log(statusLine(config));
    continue;
  }

  if (trimmed === "/thinking" || trimmed.startsWith("/thinking ")) {
    const r = await showThinkingSetupFlow(multiConfig);
    multiConfig = r.multiConfig; config = r.config;
    try { process.stdin.setRawMode(true); process.stdin.resume(); } catch {}
    console.log(statusLine(config));
    continue;
  }
  ```

  **3b. 移除 /login 处理**（约第 1306-1321 行）
  
  删除整个 `/login` 处理块：
  ```typescript
  // /permission → toggle permission mode
  if (trimmed === "/permission") {
    ...
  }

  // /login → GitHub Copilot device flow   <-- 删除这整个块
  if (trimmed === "/login") {
    const r = await runCopilotLogin(multiConfig);
    ...
  }
  ```

  **3c. 移除 /logout 处理**（约第 1323-1345 行）
  
  删除整个 `/logout` 处理块。

  **Must NOT do**: 不要移除 `/permission` 的处理

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: `[]`

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [4] | Blocked By: [1, 2]

  **References**:
  - File: `src/cli.ts:1289-1345` - REPL 命令处理区域

  **Acceptance Criteria**:
  - [ ] `/model` 调用 showModelSwitchFlow 而非 showSetupFlow
  - [ ] `/login` 和 `/logout` 处理代码已移除
  - [ ] `/provider` 和 `/thinking` 仍然正常工作

  **QA Scenarios**:
  ```
  Scenario: 验证 /login /logout 处理已移除
    Tool: Bash
    Steps: grep -n 'trimmed === "/login"\|trimmed === "/logout"' src/cli.ts
    Expected: 无匹配结果
  ```

  **Commit**: YES | Message: `refactor(cli): simplify REPL command handling, /model now switches directly` | Files: [src/cli.ts]

---

- [ ] 4. 更新 /help 帮助信息

  **What to do**:
  编辑 `src/cli.ts` 中 `/help` 命令的输出（约第 1359-1419 行）
  
  移除以下帮助条目：
  - `/login` 相关行
  - `/logout` 相关行
  - 整个 "订阅登录 — GitHub Copilot" 段落
  - 整个 "订阅登录 — OpenAI Codex" 段落
  
  简化为：
  ```typescript
  console.log(`
${PURPLE("  可用命令：")}
  ${GRAY("/")}             ${GRAY("─ 打开指令菜单")}
  ${GRAY("/provider")}     ${GRAY("─ 切换 / 配置 Provider（含订阅登录）")}
  ${GRAY("/model")}        ${GRAY("─ 切换模型")}
  ${GRAY("/thinking")}     ${GRAY("─ 调整思考水平")}
  ${GRAY("/permission")}   ${GRAY("─ 切换权限模式（默认 / Full Access）")}
  ${GRAY("/teach")}        ${GRAY("─ 开启/关闭教育模式")}
  ${GRAY("/update")}       ${GRAY("─ 更新到最新版本")}
  ${GRAY("/help")}         ${GRAY("─ 显示此帮助")}
  ${GRAY("exit / quit")}   ${GRAY("─ 退出")}
  ${GRAY("Esc")}           ${GRAY("─ 中断当前 Agent 输出")}

${PURPLE("  教育模式：")}
  ${GRAY("/teach")}                 ${GRAY("─ 开启/关闭教育模式")}
  ${GRAY("/teach on")}              ${GRAY("─ 显式开启教育模式")}
  ${GRAY("/teach off")}             ${GRAY("─ 关闭教育模式")}
  ${GRAY("/teach model <name>")}    ${GRAY("─ 设置教学模型")}
  ${GRAY("/teach level <level>")}   ${GRAY("─ 设置教学详略：简洁 / 标准 / 详细")}

... (保留工具、图片输入、版本更新、项目配置等段落)
`);
  ```

  **Must NOT do**: 不要移除工具、图片输入等其他帮助信息

  **Recommended Agent Profile**:
  - Category: `quick`
  - Skills: `[]`

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [] | Blocked By: [3]

  **References**:
  - File: `src/cli.ts:1359-1419` - /help 输出内容

  **Acceptance Criteria**:
  - [ ] /help 输出中不再包含 /login、/logout 相关信息
  - [ ] /help 输出简洁清晰

  **QA Scenarios**:
  ```
  Scenario: 帮助信息格式正确
    Tool: Bash
    Steps: grep -A50 'trimmed === "/help"' src/cli.ts | grep -E '/login|/logout'
    Expected: 无匹配结果
  ```

  **Commit**: YES | Message: `docs(cli): update /help to reflect simplified commands` | Files: [src/cli.ts]

---

## Final Verification Wave
- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy
每个 Task 完成后单独提交，便于回滚

## Success Criteria
- [ ] 输入 `/` 显示精简的命令菜单（无 /key、/login、/logout）
- [ ] `/model` 直接显示当前 provider 的模型列表
- [ ] `/provider` 流程中的登录功能不受影响
- [ ] `/help` 显示更新后的帮助信息
