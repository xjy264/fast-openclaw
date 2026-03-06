import { describe, expect, it } from "vitest";
import { buildDoctorHints } from "../src/doctor.js";
import { AppError, ErrorCodes } from "../src/errors.js";

describe("buildDoctorHints", () => {
  it("returns Telegram timeout hints", () => {
    const bundle = buildDoctorHints(
      new AppError(ErrorCodes.TELEGRAM_DISCOVERY_TIMEOUT, "timed out")
    );

    expect(bundle.summary).toContain("discovery timed out");
    expect(bundle.hints.some((item) => item.includes("/start"))).toBe(true);
  });

  it("returns gateway token hints", () => {
    const bundle = buildDoctorHints(new AppError(ErrorCodes.GATEWAY_FAILED, "no token"));

    expect(bundle.summary).toContain("Gateway check failed");
    expect(
      bundle.hints.some(
        (item) =>
          item.includes("FAST_OPENCLAW_GATEWAY_TOKEN") || item.includes("OPENCLAW_GATEWAY_TOKEN")
      )
    ).toBe(true);
  });

  it("falls back to generic hints on unknown errors", () => {
    const bundle = buildDoctorHints(new Error("unknown"));

    expect(bundle.summary).toContain("Unexpected diagnostic failure");
    expect(bundle.hints).toHaveLength(3);
  });
});
