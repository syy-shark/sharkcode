import { describe, expect, test } from "bun:test";
import { CODEX_DEVICE_VERIFICATION_URL, normalizeCodexDeviceCodeResponse } from "./codex-auth.ts";

describe("normalizeCodexDeviceCodeResponse", () => {
  test("normalizes the current OpenAI Codex device-auth response shape", () => {
    const now = Date.parse("2026-04-09T01:25:00.000Z");
    const result = normalizeCodexDeviceCodeResponse({
      device_auth_id: "deviceauth_69d7f6f324f4c81918b8fe45571b6154e",
      user_code: "7Z8Y-AJHE1",
      interval: "5",
      expires_at: "2026-04-09T09:34:46.309582+08:00",
    }, now);

    expect(result).toEqual({
      device_auth_id: "deviceauth_69d7f6f324f4c81918b8fe45571b6154e",
      user_code: "7Z8Y-AJHE1",
      verification_uri: CODEX_DEVICE_VERIFICATION_URL,
      interval: 5,
      expires_in: 587,
    });
  });

  test("keeps older RFC-style fields working for backward compatibility", () => {
    const result = normalizeCodexDeviceCodeResponse({
      device_code: "legacy-device-code",
      userCode: "ABCD-EFGH",
      verification_uri: "https://auth.openai.com/activate",
      expires_in: 600,
      interval: 10,
    });

    expect(result).toEqual({
      device_auth_id: "legacy-device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://auth.openai.com/activate",
      expires_in: 600,
      interval: 10,
    });
  });

  test("falls back to the official Codex device URL and default ttl", () => {
    const result = normalizeCodexDeviceCodeResponse({
      device_auth_id: "deviceauth_123",
      user_code: "CODE-1234",
    });

    expect(result.verification_uri).toBe(CODEX_DEVICE_VERIFICATION_URL);
    expect(result.expires_in).toBe(15 * 60);
    expect(result.interval).toBe(5);
  });
});
