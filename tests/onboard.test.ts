import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../src/errors.js";
import type { Logger } from "../src/logger.js";

vi.mock("../src/exec.js", () => ({
  runCommand: vi.fn()
}));

import { runCommand } from "../src/exec.js";
import { runOnboardGuide } from "../src/onboard.js";

const mockedRunCommand = vi.mocked(runCommand);

function createLoggerStub(): Logger {
  return {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  } as unknown as Logger;
}

describe("runOnboardGuide", () => {
  beforeEach(() => {
    mockedRunCommand.mockReset();
  });

  it("uses strict non-interactive onboard flags and does not fallback", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      code: 0,
      stdout: "",
      stderr: ""
    });

    await runOnboardGuide(createLoggerStub());

    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
    const args = mockedRunCommand.mock.calls[0][1];
    expect(args).toEqual(
      expect.arrayContaining([
        "onboard",
        "--install-daemon",
        "--non-interactive",
        "--accept-risk",
        "--flow",
        "quickstart",
        "--mode",
        "local",
        "--auth-choice",
        "skip",
        "--skip-skills",
        "--skip-channels",
        "--skip-ui",
        "--skip-health"
      ])
    );
  });

  it("throws ONBOARD_FAILED with output summary when non-interactive onboard fails", async () => {
    mockedRunCommand.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "line-one\nline-two"
    });

    await expect(runOnboardGuide(createLoggerStub())).rejects.toMatchObject({
      code: ErrorCodes.ONBOARD_FAILED,
      message: expect.stringContaining("Output summary: line-one | line-two")
    });

    expect(mockedRunCommand).toHaveBeenCalledTimes(1);
  });
});
