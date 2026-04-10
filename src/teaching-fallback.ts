import chalk from "chalk"

export interface FallbackCheckResult {
  canUse: boolean
  reason?: string
}

/**
 * Check if educational mode can be used in the current environment.
 * Returns { canUse: false, reason: "..." } if any condition fails.
 */
export function canUseEducationalMode(opts: {
  teachingEnabled: boolean
  isTTY?: boolean
  terminalWidth?: number
}): FallbackCheckResult {
  if (opts.teachingEnabled === false) {
    return { canUse: false, reason: "教育模式未启用" }
  }

  const isTTY = opts.isTTY ?? process.stdout.isTTY
  if (!isTTY) {
    return { canUse: false, reason: "非交互式终端，教育模式不可用" }
  }

  const terminalWidth = opts.terminalWidth ?? process.stdout.columns ?? 0
  if (terminalWidth < 100) {
    return { canUse: false, reason: "终端宽度不足（至少需要 100 列）" }
  }

  return { canUse: true }
}

/**
 * Print a notice to stdout explaining why educational mode is not available.
 */
export function printFallbackNotice(reason: string): void {
  process.stdout.write(
    chalk.gray(`\n  ⚠ 教育模式降级：${reason}\n  将使用普通模式继续。\n`),
  )
}
