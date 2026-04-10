import { describe, expect, it } from "bun:test"
import { canUseEducationalMode } from "./teaching-fallback.ts"

describe("canUseEducationalMode", () => {
  it("returns disabled when teaching mode is not enabled", () => {
    const result = canUseEducationalMode({
      teachingEnabled: false,
      isTTY: true,
      terminalWidth: 120,
    })

    expect(result.canUse).toBe(false)
    expect(result.reason).toContain("未启用")
  })

  it("returns disabled in a non-interactive terminal", () => {
    const result = canUseEducationalMode({
      teachingEnabled: true,
      isTTY: false,
      terminalWidth: 120,
    })

    expect(result.canUse).toBe(false)
    expect(result.reason).toContain("非交互式")
  })

  it("returns disabled when terminal width is below 100", () => {
    const result = canUseEducationalMode({
      teachingEnabled: true,
      isTTY: true,
      terminalWidth: 80,
    })

    expect(result.canUse).toBe(false)
    expect(result.reason).toContain("宽度")
  })

  it("returns disabled when terminal width is 99", () => {
    const result = canUseEducationalMode({
      teachingEnabled: true,
      isTTY: true,
      terminalWidth: 99,
    })

    expect(result.canUse).toBe(false)
  })

  it("returns enabled at the 100-column boundary", () => {
    const result = canUseEducationalMode({
      teachingEnabled: true,
      isTTY: true,
      terminalWidth: 100,
    })

    expect(result).toEqual({ canUse: true })
  })

  it("returns enabled when all conditions are satisfied", () => {
    const result = canUseEducationalMode({
      teachingEnabled: true,
      isTTY: true,
      terminalWidth: 120,
    })

    expect(result).toEqual({ canUse: true })
  })

  it("short-circuits on teachingEnabled before checking TTY", () => {
    const result = canUseEducationalMode({
      teachingEnabled: false,
      isTTY: false,
      terminalWidth: 80,
    })

    expect(result.canUse).toBe(false)
    expect(result.reason).toContain("未启用")
    expect(result.reason).not.toContain("非交互式")
  })
})
