import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";

export async function runOnboardGuide(logger: Logger): Promise<void> {
  logger.info("Starting OpenClaw onboard wizard...");
  logger.info("Follow these selections in the wizard:");
  logger.info("1) Model config: choose skip for now (or any temp option)");
  logger.info("2) Skills: choose skip for now");
  logger.info("3) Hooks: press space to keep all unchecked, then confirm");

  const result = await runCommand("openclaw", ["onboard", "--install-daemon"], {
    inheritStdio: true
  });

  if (result.code !== 0) {
    throw new AppError(ErrorCodes.ONBOARD_FAILED, "openclaw onboard failed.");
  }
}
