import { describe, expect, it } from "vitest";
import { buildDoctorHints } from "../src/doctor.js";
import { AppError, ErrorCodes } from "../src/errors.js";

describe("buildDoctorHints", () => {
  it("returns Telegram timeout hints", () => {
    const bundle = buildDoctorHints(
      new AppError(ErrorCodes.TELEGRAM_DISCOVERY_TIMEOUT, "timed out")
    );

    expect(bundle.summary).toContain("轮询超时");
    expect(bundle.hints.some((item) => item.includes("--telegram-chat-id"))).toBe(true);
  });

  it("returns gateway token hints", () => {
    const bundle = buildDoctorHints(new AppError(ErrorCodes.GATEWAY_FAILED, "no token"));

    expect(bundle.summary).toContain("Gateway 检查失败");
    expect(
      bundle.hints.some(
        (item) =>
          item.includes("FAST_OPENCLAW_GATEWAY_TOKEN") || item.includes("OPENCLAW_GATEWAY_TOKEN")
      )
    ).toBe(true);
  });

  it("falls back to generic hints on unknown errors", () => {
    const bundle = buildDoctorHints(new Error("unknown"));

    expect(bundle.summary).toContain("未预期");
    expect(bundle.hints).toHaveLength(3);
  });

  it("returns dingtalk plugin hints", () => {
    const bundle = buildDoctorHints(
      new AppError(ErrorCodes.CHANNEL_PLUGIN_INSTALL_FAILED, "plugin install failed")
    );

    expect(bundle.summary).toContain("插件安装失败");
    expect(bundle.hints.some((item) => item.includes("openclaw plugins install openclaw-dingtalk"))).toBe(true);
  });
});
