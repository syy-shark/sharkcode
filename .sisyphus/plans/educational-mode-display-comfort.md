# Redesign Educational Mode for Comfortable Multi-Turn Use

## TL;DR
> **Summary**: Replace the current per-turn educational TUI with a single persistent session shell that keeps one main execution/teaching workspace alive across the whole REPL session, adds a right-side conversation directory, and stores finalized per-turn snapshots instead of replaying capped raw deltas.
> **Deliverables**:
> - Persistent educational session shell with prompt/input ownership
> - Main 4/5 workspace (execution + teaching) plus clamped right-side directory
> - Auto-collapsed history entries that can be reopened in the main workspace
> - Height-aware/manual pane viewporting and stable teaching-step rendering
> - Multi-turn regression tests covering persistence, collapse/reopen, overflow, and fallback
> **Effort**: XL
> **Parallel**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 6/7/8 → Task 10

## Context

### Original Request
User feedback on the educational mode evolved from “right pane unavailable” into a broader comfort problem:
- completed runs leave old pane pairs in terminal history
- later turns create another pair of left/right panes below the previous pair
- long content causes visible clipping/loss of context
- teaching explanations can visually start at `2.` instead of `1.`
- user wants a right-side directory, auto-collapsed history, and reopenable past turns

### Interview Summary
- User explicitly chose **single persistent workspace + auto-collapsed history** over keeping full pane history inline.
- User wants a **right-side directory** (~1/5 of the screen) where each turn is listed and can be reopened later.
- User wants the **main workspace** to remain visually dominant and comfortable; history should not force manual scrolling through stacked pane snapshots.
- User accepted auto-collapse, but required that collapsed turns remain reopenable.
- User asked for the final display to feel “非常舒服”, which changes this from a local layout tweak to a session-architecture redesign.

### Metis Review (gaps addressed)
- Must treat this as a **persistent session shell** problem, not a component-only patch.
- Must define a **single input owner**; current raw REPL prompt + permission prompt + new sidebar navigation would otherwise conflict.
- Must stop using capped raw teaching deltas as the source of truth; they can lose the beginning of the explanation.
- Must add a **height guard** in addition to width guard.
- Must make late events route to the correct completed turn via explicit `turnId` binding.

## Work Objectives

### Core Objective
Deliver a persistent educational session UI that keeps one stable workspace for execution + teaching across multiple turns, adds a conversation directory for fast history access, and eliminates clipped/misaligned/half-missing content.

### Deliverables
- [ ] Persistent educational session shell in `src/ui/` that survives across turns
- [ ] Session-level turn state model with per-turn snapshots and directory metadata
- [ ] Right-side directory sidebar with auto-collapse and reopen behavior
- [ ] Height-aware/manual viewporting for execution and teaching panes
- [ ] Stable structured teaching rendering that never “starts from 2” because early deltas were dropped
- [ ] In-shell permission modal for educational mode
- [ ] Width + height fallback/degraded-mode policy
- [ ] Regression tests for multi-turn persistence, late-event routing, history reopen, overflow, and fallback

### Definition of Done (verifiable conditions with commands)
- `bun test src/ui/EducationalSessionShell.test.tsx` exits `0` and covers persistent multi-turn behavior
- `bun test src/ui/ExecutionPane.test.tsx src/ui/TeachingPane.test.tsx` exits `0` and covers viewport + formatting regressions
- `bun test src/permission.test.ts src/teaching-fallback.test.ts` exits `0` and covers shell permission/fallback behavior
- `bun test` exits `0`
- `bunx tsc --noEmit` exits `0`

### Must Have
- Exactly **one** mounted educational workspace while teaching mode is active in the REPL
- One main workspace composed of:
  - execution pane
  - teaching pane
  - right-side directory sidebar
- On supported terminal sizes, the right-side directory sidebar must be visible from the **first live turn** onward; missing sidebar chrome is a failure unless the shell is explicitly in degraded-mode overlay
- Completed turn remains expanded until the next turn starts; then it auto-collapses into history
- Selecting a history item reopens that turn in the main workspace
- New turn start always snaps focus back to the live turn
- Teaching content must be persisted as finalized structured output, not replayed from capped raw event arrays
- Execution and teaching panes must have manual height-aware viewporting
- Teaching pane must never revert to “waiting” after any teaching content has been received
- Teaching pane rendering must be **monotonic** during a turn: once content has been shown, later renders may append or reformat into structured sections, but must never drop the already received prefix or visibly jump from step `1.` to step `2.` because the beginning was lost
- Educational mode must degrade when width/height is too small
- Previous educational-mode fixes must remain intact: async teaching provider, abort, timeout, suppressed stdout mixing

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No stacked per-turn pane snapshots in normal terminal scrollback as the primary history UX
- No cross-session persistence of educational history
- No search/filter/tagging/pinning/replay timeline in the sidebar
- No dependency on raw numbered markdown from the model for correct teaching-step display
- No inline sidebar expansion that changes the overall shell height; reopening always happens in the main workspace
- No browsing old turns during an active permission prompt or live agent run
- No new external UI dependency for scrolling; use manual windowing with existing stack

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- **Test decision**: tests-after + `ink-testing-library` + targeted Bun render scripts + `bun test`
- **QA policy**: Every task includes exact test or render assertions; no “looks good to me” checks
- **Evidence**: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy

### Parallel Execution Waves

**Wave 1: Session foundation + lifecycle ownership**
- Task 1: Define session-level turn controller and snapshot model
- Task 2: Replace per-turn mount lifecycle with a persistent educational session shell
- Task 3: Move prompt/slash ownership into the shell with explicit suspend/resume modal flow
- Task 4: Replace stderr permission box with an in-shell permission modal for educational mode
- Task 5: Add width/height sizing policy, sidebar clamping, and degraded-mode behavior

**Wave 2: Main workspace UX + history model**
- Task 6: Build right-side directory sidebar with auto-collapse and reopen semantics
- Task 7: Refactor execution pane to use stable snapshots and manual viewporting
- Task 8: Refactor teaching pipeline + pane to use structured sections, stable numbering, and manual viewporting
- Task 9: Route late events to the correct turn and finalize per-turn snapshots safely

**Wave 3: Regression and ship-readiness**
- Task 10: Add multi-turn regression suite and shell QA coverage

### Dependency Matrix
| Task | Depends On | Blocks |
|------|------------|--------|
| 1 | - | 2, 3, 6, 7, 8, 9, 10 |
| 2 | 1 | 3, 4, 5, 6, 9, 10 |
| 3 | 1, 2 | 4, 10 |
| 4 | 2, 3 | 10 |
| 5 | 2 | 10 |
| 6 | 1, 2 | 10 |
| 7 | 1, 2 | 10 |
| 8 | 1, 2 | 10 |
| 9 | 1, 2, 6, 7, 8 | 10 |
| 10 | 3, 4, 5, 6, 7, 8, 9 | - |

### Agent Dispatch Summary
| Wave | Task Count | Categories |
|------|------------|------------|
| 1 | 5 | deep, visual-engineering |
| 2 | 4 | visual-engineering, deep |
| 3 | 1 | unspecified-high |

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Define persistent session controller and turn snapshot model

  **What to do**:
  1. Add a session-level state module in `src/ui/` (new file) that defines:
     - `EducationalTurnRecord`
     - `TurnStatus = "running" | "teaching" | "completed" | "interrupted" | "failed" | "timeout"`
     - `FocusTarget = "input" | "sidebar" | "execution" | "teaching" | "permission"`
     - per-turn viewport state for execution and teaching panes
     - session retention limits: `MAX_TURNS = 30`, `MAX_EXECUTION_ITEMS_PER_TURN = 120`, `MAX_TEACHING_CHARS_PER_TURN = 24000`
  2. Store **derived snapshots** instead of raw replay-only event arrays:
     - execution timeline items with stable sequence IDs
     - live teaching draft string
     - finalized `TeachingSnapshot`
     - directory metadata (title, status, summary line)
  3. Create the turn record **before** agent execution starts so errors/interruption/timeout still produce a visible directory entry.
  4. Define exact auto-collapse rule: a finished turn stays expanded until a newer turn starts; on next turn start, it collapses into the sidebar.

  **Must NOT do**:
  - Do not persist history across CLI restarts
  - Do not use capped raw delta arrays as the only source of truth for historical re-open
  - Do not match archived tool state by `toolName` in the pane component itself

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This is the state/lifecycle foundation for every later task.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 6, 7, 8, 9, 10 | Blocked By: -

  **References**:
  - Pattern: `src/cli.ts:1565-1659` — Current per-turn event collection and shell mount point
  - Pattern: `src/ui/EducationalApp.tsx:38-42` — Current per-run local state only
  - Pattern: `src/ui/EducationalApp.tsx:85-93` — Current exit-after-run contract
  - API/Type: `src/agent-events.ts:1-11` — Agent event contract to consume
  - API/Type: `src/teaching.ts:6-17` — Teaching event/context contract to consume

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/educational-session-state.test.ts -t "creates turn before run starts"` exits `0`
  - [ ] `bun test src/ui/educational-session-state.test.ts -t "retains finalized snapshots without replaying raw deltas"` exits `0`
  - [ ] `bun test src/ui/educational-session-state.test.ts -t "evicts oldest collapsed turn at max retention"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Turn exists before events arrive
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/educational-session-state.test.ts -t "creates turn before run starts"`
      2. Assert frame/state includes a pending turn record with status `running`
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-1-turn-bootstrap.txt

  Scenario: Historical turn survives long teaching stream
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/educational-session-state.test.ts -t "retains finalized snapshots without replaying raw deltas"`
      2. Assert reopened teaching text still begins with the original first section
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-1-snapshot-retention.txt
  ```

  **Commit**: YES | Message: `refactor(edu): add persistent session turn controller` | Files: `src/ui/*session*`, related tests

---

- [ ] 2. Replace per-turn mount lifecycle with one persistent educational session shell

  **What to do**:
  1. Introduce a new persistent session shell component in `src/ui/` (new file) that stays mounted for the entire teaching-enabled REPL session.
  2. Replace the current `cli.ts` branch that creates a new `startEducationalApp(...)` per turn with a session-level mount performed once when educational mode is active.
  3. Keep previous single-turn `EducationalApp.tsx` behavior only as a migration reference; the new REPL path must use the session shell.
  4. Preserve conversation `messages` across turns and across entering/leaving educational mode.
  5. Exact transition rules:
     - `/teach on` in plain REPL mounts the session shell before the next prompt
     - `/teach off` inside the shell tears it down and returns to plain REPL
     - exiting the REPL unmounts the shell once

  **Must NOT do**:
  - Do not keep the current per-turn mount/unmount path hidden under new chrome
  - Do not mount a second Ink app while the session shell is already active

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This is REPL lifecycle surgery crossing UI + CLI boundaries.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3, 4, 5, 6, 9, 10 | Blocked By: 1

  **References**:
  - Pattern: `src/cli.ts:1293-1669` — Current REPL loop and mount points
  - Pattern: `src/ui/EducationalApp.tsx:119-133` — Current render/unmount entry point to replace
  - Test: `src/ui/EducationalApp.test.tsx:109-317` — Current tests that encode single-turn exit behavior

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "keeps one persistent workspace across multiple turns"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "does not duplicate pane headers after two turns"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: One shell across two turns
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "keeps one persistent workspace across multiple turns"`
      2. Assert final frame contains exactly one `⚡ 执行过程` and one `📚 教学讲解`
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-2-persistent-shell.txt

  Scenario: No stacked pane snapshots
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "does not duplicate pane headers after two turns"`
      2. Assert no second pane pair appears in the final rendered frame
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-2-no-duplicate-headers.txt
  ```

  **Commit**: YES | Message: `refactor(edu): keep a single educational shell across turns` | Files: `src/cli.ts`, new session shell file(s), updated tests

---

- [ ] 3. Move prompt and slash-command ownership into the shell

  **What to do**:
  1. Add a bottom prompt row inside the session shell; once the shell is mounted, it owns stdin by default.
  2. Recreate the current slash palette behavior inside the shell using the same command list/order as `SLASH_COMMANDS`.
  3. Support the following in-shell command behavior:
     - `/help`, `/clear`, `/exit`, `/teach off` handled directly in-shell
     - `/provider`, `/model`, `/thinking`, `/permission`, `/update`, `/teach model`, `/teach level` temporarily suspend shell input ownership, run the existing CLI helper flow, then resume/redraw the shell with preserved session state
  4. Exact key model:
     - `Enter`: submit input or confirm selected history entry
     - `Tab`: cycle focus `input → sidebar → execution → teaching → input`
     - `Esc`: close slash palette, else interrupt live run when allowed, else return focus to input
     - `↑/↓`: move sidebar selection or scroll focused pane
     - `PageUp/PageDown`: scroll focused pane by 10 lines
     - `Home/End`: jump to top/bottom of focused pane

  **Must NOT do**:
  - Do not keep `readLineWithPalette()` / `readLineRaw()` as the active prompt path while the shell is mounted
  - Do not allow two simultaneous input owners

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Requires careful stdin ownership and shell/CLI handoff.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4, 10 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/cli.ts:315-381` — Current command menu flow
  - Pattern: `src/cli.ts:795-1048` — Current raw prompt and slash palette logic
  - Pattern: `src/cli.ts:1382-1517` — Current in-loop slash handling branch
  - API/Type: `src/interrupt.ts:25-72` — Current interrupt gating behavior to preserve

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "cycles focus with Tab and scrolls the focused region"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "opens slash palette and closes it with Esc"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "suspends shell input for provider modal and resumes after completion"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Prompt ownership stays inside shell
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "cycles focus with Tab and scrolls the focused region"`
      2. Assert no external prompt row is rendered outside the shell frame
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-3-shell-input-owner.txt

  Scenario: Slash palette suspend/resume works
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "suspends shell input for provider modal and resumes after completion"`
      2. Assert shell resumes with preserved turn history after the modal flow returns
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-3-shell-modal-resume.txt
  ```

  **Commit**: YES | Message: `feat(edu): move prompt and slash controls into session shell` | Files: session shell prompt/palette files, `src/cli.ts`, tests

---

- [ ] 4. Replace stderr permission prompts with an in-shell permission modal

  **What to do**:
  1. Add a permission UI adapter so `askPermission()` can use the shell when it is active.
  2. Render permission approval as an in-shell modal/overlay instead of the current stderr box while educational shell is mounted.
  3. Lock focus to `permission` while approval is open; disable sidebar navigation and historical reopen.
  4. Keep existing `y / n / a` semantics exactly.
  5. Preserve current non-educational fallback: if shell is inactive, `permission.ts` can keep the existing stderr prompt.
  6. Preserve silent auto-approved behavior in full-access mode inside educational mode.

  **Must NOT do**:
  - Do not write permission UI directly to stderr while shell is active
  - Do not let `Esc` interrupt the run during a permission decision

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Permission ownership collides with stdin handling and interrupts.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: YES (with Task 5 after Task 3 contract is fixed) | Wave 1 | Blocks: 10 | Blocked By: 2, 3

  **References**:
  - Pattern: `src/permission.ts:28-92` — Current stderr-based permission flow
  - Pattern: `src/interrupt.ts:36-66` — Current permission gating for interrupts
  - Test: `src/permission.test.ts:1-45` — Current suppression test pattern

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "renders permission approval inside shell without stderr artifacts"` exits `0`
  - [ ] `bun test src/permission.test.ts -t "suppresses auto-approved output when requested"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "ignores Esc as interrupt while permission modal is open"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Permission modal stays in-shell
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "renders permission approval inside shell without stderr artifacts"`
      2. Assert final frame contains the approval UI inside the shell and no raw stderr box output
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-4-in-shell-permission.txt

  Scenario: Auto-approved output remains silent
    Tool: Bash
    Steps:
      1. Run `bun test src/permission.test.ts -t "suppresses auto-approved output when requested"`
      2. Assert no `auto-approved` line is written outside the shell frame
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-4-auto-approved-silent.txt
  ```

  **Commit**: YES | Message: `feat(edu): render permission prompts inside the session shell` | Files: `src/permission.ts`, session shell modal files, tests

---

- [ ] 5. Add width/height policy, sidebar clamping, and degraded-mode behavior

  **What to do**:
  1. Upgrade educational fallback policy to enforce both width and height:
     - `MIN_FULL_WIDTH = 120`
     - `MIN_FULL_HEIGHT = 28`
  2. Define layout sizing exactly:
     - `sidebarWidth = clamp(floor(columns * 0.2), 24, 30)`
     - `mainWidth = columns - sidebarWidth`
     - `executionWidth = floor(mainWidth * 0.45)`
     - `teachingWidth = mainWidth - executionWidth`
  3. On startup below minimum size, do not mount the shell; keep the current fallback notice path.
  4. On live resize below minimum size after mount, keep the shell mounted but switch to a degraded overlay state that:
     - pauses directory navigation
     - keeps buffering the active turn
     - restores the full workspace automatically once dimensions recover

  **Must NOT do**:
  - Do not keep the current width-only guard
  - Do not use a literal 1/5 sidebar width at all terminal sizes without clamping

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: Requires exact fallback and resize behavior decisions.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: YES (with Task 4 after shell contract is fixed) | Wave 1 | Blocks: 10 | Blocked By: 2

  **References**:
  - Pattern: `src/teaching-fallback.ts:12-31` — Current width-only fallback
  - Test: `src/teaching-fallback.test.ts:4-79` — Current width-boundary tests to extend
  - Pattern: `src/ui/EducationalApp.tsx:95-115` — Current 50/50 pane layout to replace

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "renders sidebar on the first live turn at supported size"` exits `0`
  - [ ] `bun test src/teaching-fallback.test.ts -t "rejects insufficient terminal height"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "clamps sidebar width at narrow supported terminals"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "shows degraded overlay on live resize below minimum height"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Height guard rejects cramped terminals
    Tool: Bash
    Steps:
      1. Run `bun test src/teaching-fallback.test.ts -t "rejects insufficient terminal height"`
      2. Assert failure reason mentions height explicitly
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-5-height-guard.txt

  Scenario: Sidebar clamps instead of crushing main content
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "clamps sidebar width at narrow supported terminals"`
      2. Assert the sidebar width stays within 24-30 columns and panes still render
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-5-sidebar-clamp.txt

  Scenario: Sidebar is present on the first live turn
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "renders sidebar on the first live turn at supported size"`
      2. Assert the frame contains the sidebar header and at least one live directory entry while turn 1 is active
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-5-sidebar-first-turn.txt
  ```

  **Commit**: YES | Message: `feat(edu): add size policy and degraded-mode behavior` | Files: `src/teaching-fallback.ts`, shell layout files, tests

---

- [ ] 6. Build the right-side directory sidebar with auto-collapse and reopen behavior

  **What to do**:
  1. Add a dedicated sidebar component in `src/ui/` for turn directory rendering.
  2. Render newest turn first.
  3. Each directory entry is exactly two lines max:
     - line 1: status icon + truncated user prompt preview
     - line 2: dim meta summary (`状态 · 工具数/步骤数 · 时间`)
  4. Exact behavior:
     - live turn is always selected when it starts
     - a finished turn stays expanded until the next turn starts
     - when the next turn starts, the previous finished turn auto-collapses into the sidebar
     - selecting a historical turn and pressing `Enter` reopens it in the main workspace
     - no inline sidebar expansion beyond two lines; reopening is always in the main workspace
  5. Disable historical reopen while a permission modal is open or while a new turn is still live.

  **Must NOT do**:
  - Do not leave the old turn expanded in the main workspace once a newer live turn starts
  - Do not expand history inline in the sidebar and change total shell height

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: Strong layout/navigation component with clear interaction rules.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: YES (with Tasks 7 and 8 after Tasks 1 and 2) | Wave 2 | Blocks: 9, 10 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/ui/EducationalApp.tsx:95-115` — Current two-pane layout to generalize into three regions
  - Pattern: `src/cli.ts:1565-1631` — Current per-turn orchestration source to convert into directory entries
  - Test: `src/ui/EducationalApp.test.tsx:93-107` — Current two-pane render assertions to supersede with shell tests

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "auto-collapses completed turns into the directory when a new turn starts"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "reopens completed turn from sidebar into the main workspace"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "snaps focus back to live turn when a new turn begins"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Completed turn auto-collapses on next turn start
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "auto-collapses completed turns into the directory when a new turn starts"`
      2. Assert turn 1 becomes a compact sidebar item when turn 2 starts
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-6-auto-collapse.txt

  Scenario: Sidebar reopen restores full historical view
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "reopens completed turn from sidebar into the main workspace"`
      2. Assert main panes show turn-1 execution and teaching content after selecting turn 1
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-6-reopen-history.txt
  ```

  **Commit**: YES | Message: `feat(edu): add directory sidebar with collapsible history` | Files: new sidebar component, shell component, tests

---

- [ ] 7. Refactor execution pane to stable snapshots and manual viewporting

  **What to do**:
  1. Stop passing raw `AgentEvent[]` into the final display path for history.
  2. Introduce a stable execution timeline snapshot type with explicit item IDs, types, and text blocks.
  3. Remove the current `slice(-50)` display truncation from the pane; retention belongs in the session controller.
  4. Add manual viewporting based on pane height and a stored `executionViewport.topLine`.
  5. Exact viewport behavior:
     - live turn auto-follows bottom during agent execution
     - when the turn finalizes, reset viewport to top
     - reopening a historical turn always opens at top
     - `↑/↓/PageUp/PageDown/Home/End` scroll when the execution pane has focus
  6. Keep distinct visual states for `等待 / 正在思考 / 执行中 / 已中断 / 已完成 / 已失败`.

  **Must NOT do**:
  - Do not reconstruct archived execution content by replaying capped raw events in the pane
  - Do not match final tool state purely by `toolName` inside the pane component

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: Snapshot rendering and viewport UX are pane-level display work.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: YES (with Tasks 6 and 8 after Tasks 1 and 2) | Wave 2 | Blocks: 9, 10 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/ui/ExecutionPane.tsx:12-64` — Current aggregation model to replace with controller-owned snapshots
  - Pattern: `src/ui/ExecutionPane.tsx:70-133` — Current raw pane rendering and `slice(-50)` truncation
  - Test: `src/ui/ExecutionPane.test.tsx:58-110` — Existing pane assertions to extend with viewport behavior

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/ExecutionPane.test.tsx -t "opens finalized turn at the top of the execution snapshot"` exits `0`
  - [ ] `bun test src/ui/ExecutionPane.test.tsx -t "scrolls execution viewport without losing the first item"` exits `0`
  - [ ] `bun test src/ui/ExecutionPane.test.tsx -t "renders interrupted state distinctly from done"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Long execution history remains readable
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/ExecutionPane.test.tsx -t "scrolls execution viewport without losing the first item"`
      2. Assert the first execution item is reachable after reopening and scrolling
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-7-execution-viewport.txt

  Scenario: Finalized turn opens from the top
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/ExecutionPane.test.tsx -t "opens finalized turn at the top of the execution snapshot"`
      2. Assert the main workspace shows the beginning of the archived execution, not the tail
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-7-archive-top.txt
  ```

  **Commit**: YES | Message: `feat(edu): add execution snapshots and manual viewporting` | Files: `src/ui/ExecutionPane.tsx`, new view-model helpers, tests

---

- [ ] 8. Refactor teaching pipeline and pane to stable sections, stable numbering, and manual viewporting

  **What to do**:
  1. Change the teaching prompt to require these exact section markers:
     - `【本轮概况】`
     - `【关键步骤】`
     - `【结果与下一步】`
  2. During teaching generation, accumulate a full draft string capped by `MAX_TEACHING_CHARS_PER_TURN = 24000`; do **not** keep only the last 100 deltas.
  3. On `teaching-end` / `teaching-error` / timeout, normalize the draft into a finalized `TeachingSnapshot`:
     - `summary: string[]`
     - `steps: string[]`
     - `result: string[]`
     - `rawFallback: string`
  4. Render `steps` as UI-numbered items `1..N` with a fixed label column and hanging-indent body lines.
  5. If parsing fails, render paragraph blocks from `rawFallback` while preserving the beginning of the response.
  6. Add a manual viewport to the teaching pane with the same navigation keys as execution pane.
  7. Exact live/final behavior:
     - while generating, teaching pane shows the live draft text
     - when the turn finalizes, viewport resets to the top of the finalized snapshot
     - once any teaching content is received, the pane may never fall back to `等待 Agent 执行完成...`

  **Must NOT do**:
  - Do not rely on model-generated markdown numbering for final visible order
  - Do not rebuild final teaching text by replaying capped raw delta arrays
  - Do not let the first visible completed step be `2.` because step `1.` was evicted

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: Combines prompt-driven content shaping with final pane rendering.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: YES (with Tasks 6 and 7 after Tasks 1 and 2) | Wave 2 | Blocks: 9, 10 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/teaching.ts:107-123` — Current teaching system prompt to tighten
  - Pattern: `src/teaching.ts:126-172` — Current user prompt structure to replace with explicit sections
  - Pattern: `src/ui/TeachingPane.tsx:9-68` — Current raw text rendering and waiting/generating/done state machine
  - Test: `src/ui/TeachingPane.test.tsx:7-58` — Existing state tests to extend with long-stream + numbering coverage
  - Test: `src/teaching.test.ts:67-176` — Existing teaching prompt tests to extend

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/TeachingPane.test.tsx -t "preserves the first teaching section across more than 100 deltas"` exits `0`
  - [ ] `bun test src/ui/TeachingPane.test.tsx -t "never drops already rendered prefix while teaching is still streaming"` exits `0`
  - [ ] `bun test src/ui/TeachingPane.test.tsx -t "renders numbered steps starting from 1 with hanging indentation"` exits `0`
  - [ ] `bun test src/teaching.test.ts -t "requests explicit teaching sections and no fluffy praise"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Teaching text never starts mid-list
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/TeachingPane.test.tsx -t "preserves the first teaching section across more than 100 deltas"`
      2. Assert the finalized frame still starts with section/step 1, not step 2
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-8-preserve-first-step.txt

  Scenario: Hanging indentation stays readable
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/TeachingPane.test.tsx -t "renders numbered steps starting from 1 with hanging indentation"`
      2. Assert wrapped continuation lines align under the step body rather than under the label
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-8-hanging-indent.txt

  Scenario: Teaching text grows monotonically during streaming
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/TeachingPane.test.tsx -t "never drops already rendered prefix while teaching is still streaming"`
      2. Assert every later frame retains the earlier visible prefix and never regresses to a later step number only
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-8-monotonic-stream.txt
  ```

  **Commit**: YES | Message: `feat(edu): stabilize teaching sections and pane viewporting` | Files: `src/teaching.ts`, `src/ui/TeachingPane.tsx`, new parser helpers, tests

---

- [ ] 9. Route late events to the correct turn and finalize snapshots safely

  **What to do**:
  1. Bind every live run/teaching pipeline to a concrete `turnId` created by the session controller.
  2. Ensure delayed `teaching-end`, `teaching-error`, timeout, and synthetic `run-end` events update the original turn only.
  3. Persist partial teaching content on timeout/error/interruption instead of discarding it.
  4. Keep `selectedTurnId` stable when late events affect a different historical turn; the shell may update that historical directory status without stealing focus.
  5. New turn start always changes `activeTurnId` and `selectedTurnId` to the live turn.

  **Must NOT do**:
  - Do not let late events mutate whichever turn happens to be selected
  - Do not discard partial teaching text on failure/timeout

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: This is asynchronous correctness work across controller, CLI, and panes.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — No browser work.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 10 | Blocked By: 1, 2, 6, 7, 8

  **References**:
  - Pattern: `src/cli.ts:1590-1619` — Current one-turn event collection and teaching launch
  - Pattern: `src/cli.ts:1646-1654` — Current error path and synthetic run-end fallback
  - Pattern: `src/ui/EducationalApp.tsx:66-93` — Current completion/timeout exit behavior to preserve conceptually per turn

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "routes late teaching completion to the original turn only"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "stores partial teaching text on timeout and marks the turn timeout"` exits `0`
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx -t "keeps selected historical turn stable while a different turn receives late updates"` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Late teaching event does not mutate the wrong turn
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "routes late teaching completion to the original turn only"`
      2. Assert turn 1 receives the late teaching completion while turn 2 stays unchanged
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-9-late-event-routing.txt

  Scenario: Timeout preserves partial teaching text
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx -t "stores partial teaching text on timeout and marks the turn timeout"`
      2. Assert the reopened timed-out turn still shows the partial teaching content at the top
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-9-timeout-partial.txt
  ```

  **Commit**: YES | Message: `fix(edu): route late events by turn and preserve partial snapshots` | Files: controller files, `src/cli.ts`, tests

---

- [ ] 10. Add multi-turn regression coverage and final shell QA

  **What to do**:
  1. Add shell-level tests for:
     - single persistent workspace across multiple turns
     - sidebar visible on the first live turn
     - auto-collapse + reopen
     - snap-to-live on new turn
     - height/width degraded mode
     - in-shell permission modal
     - long teaching streams
     - monotonic teaching streaming without losing the first prefix
     - interrupted / failed / timeout directory labels
     - `/teach off`, `/clear`, `/exit` behavior while shell is mounted
  2. Extend fallback tests with height checks.
  3. Extend teaching tests with explicit-section prompt assertions.
  4. Run full verification:
     - `bun test`
     - `bunx tsc --noEmit`
  5. Add one Bun render-script test/frame capture that simulates two full turns and asserts the final frame contains:
     - one execution pane
     - one teaching pane
     - a sidebar with two entries
     - no duplicated pane headers

  **Must NOT do**:
  - Do not stop at unit tests that only cover single-turn render states
  - Do not rely on human screenshot inspection for pass/fail

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Broad integration validation across lifecycle, layout, and interaction.
  - Skills: [] — No extra skill required.
  - Omitted: [`playwright`] — Terminal UI work, not browser UI.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: - | Blocked By: 3, 4, 5, 6, 7, 8, 9

  **References**:
  - Test: `src/ui/EducationalApp.test.tsx:109-317` — Existing lifecycle coverage to migrate/replace
  - Test: `src/ui/ExecutionPane.test.tsx:58-110` — Existing execution pane assertions to preserve where applicable
  - Test: `src/ui/TeachingPane.test.tsx:7-58` — Existing teaching pane assertions to preserve where applicable
  - Test: `src/teaching-fallback.test.ts:4-79` — Existing fallback test file to extend

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun test src/ui/EducationalSessionShell.test.tsx` exits `0`
  - [ ] `bun test src/ui/ExecutionPane.test.tsx src/ui/TeachingPane.test.tsx src/permission.test.ts src/teaching-fallback.test.ts` exits `0`
  - [ ] `bun test` exits `0`
  - [ ] `bunx tsc --noEmit` exits `0`

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Full shell regression suite
    Tool: Bash
    Steps:
      1. Run `bun test src/ui/EducationalSessionShell.test.tsx`
      2. Assert all shell scenarios pass, including multi-turn persistence and history reopen
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-10-shell-suite.txt

  Scenario: Whole-project verification
    Tool: Bash
    Steps:
      1. Run `bun test`
      2. Run `bunx tsc --noEmit`
      3. Assert both exit with code 0
    Expected: exit code 0
    Evidence: .sisyphus/evidence/task-10-full-verification.txt
  ```

  **Commit**: YES | Message: `test(edu): add persistent-session regression coverage` | Files: new shell tests, extended pane/fallback/permission tests

---

## Final Verification Wave (4 parallel agents, ALL must APPROVE)
- [ ] F1. Plan Compliance Audit — oracle
  - Verify the implementation creates a single persistent educational shell rather than stacked per-turn apps
  - Verify every acceptance criterion above is concretely satisfied

- [ ] F2. Code Quality Review — unspecified-high
  - Verify no lifecycle leaks, no duplicate stdin owners, and no late-event mutation bugs

- [ ] F3. Real Shell QA — unspecified-high
  - Run a script or terminal-driven Ink test that simulates two turns, history reopen, permission modal, timeout, and resize degradation

- [ ] F4. Scope Fidelity Check — deep
  - Verify no cross-session persistence/search/filter/pinning/replay work was added

## Commit Strategy
- Commit after each task group; do not mix shell lifecycle, pane formatting, and tests in one commit.
- Preferred sequence:
  1. `refactor(edu): add persistent session turn controller`
  2. `refactor(edu): keep a single educational shell across turns`
  3. `feat(edu): move prompt and slash controls into session shell`
  4. `feat(edu): render permission prompts inside the session shell`
  5. `feat(edu): add size policy and degraded-mode behavior`
  6. `feat(edu): add directory sidebar with collapsible history`
  7. `feat(edu): add execution snapshots and manual viewporting`
  8. `feat(edu): stabilize teaching sections and pane viewporting`
  9. `fix(edu): route late events by turn and preserve partial snapshots`
  10. `test(edu): add persistent-session regression coverage`

## Success Criteria
1. Educational mode keeps exactly one persistent main workspace instead of stacking pane snapshots turn after turn.
2. Old turns auto-collapse into a right-side directory and can be reopened in the main workspace.
3. New turns always focus the live turn without mutating the wrong historical turn.
4. Execution and teaching panes remain readable on long content because they use manual viewporting and finalized snapshots.
5. Teaching content never visibly starts at `2.` because early deltas were dropped; the first visible step is stable and properly formatted.
6. Educational mode no longer relies on stderr permission boxes or external raw prompt rendering while the shell is active.
7. Width + height fallback rules protect comfort instead of cramming a 3-region layout into an unreadable terminal.
8. `bun test` and `bunx tsc --noEmit` both pass.
