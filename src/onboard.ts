import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";

function summarizeOutput(output: string, maxLines = 10): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  if (lines.length === 0) {
    return "no command output";
  }

  return lines.join(" | ");
}

export async function runOnboardGuide(logger: Logger): Promise<void> {
  logger.info("Starting OpenClaw onboard (strict non-interactive quickstart) ...");

  const nonInteractive = await runCommand(
    "openclaw",
    [
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
    ]
  );

  if (nonInteractive.code === 0) {
    return;
  }

  const summary = summarizeOutput(`${nonInteractive.stdout}\n${nonInteractive.stderr}`);
  logger.error(`OpenClaw non-interactive onboard failed. Output summary: ${summary}`);
  throw new AppError(
    ErrorCodes.ONBOARD_FAILED,
    `openclaw onboard non-interactive failed. Output summary: ${summary}`
  );
}
