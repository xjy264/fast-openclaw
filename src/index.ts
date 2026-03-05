#!/usr/bin/env node
import { password } from "@inquirer/prompts";
import { Command } from "commander";
import { ApiClient } from "./api.js";
import { buildBrowserConfigPatch } from "./browser.js";
import { mergeAndWriteConfig } from "./config.js";
import { AppError, ErrorCodes } from "./errors.js";
import { buildDeviceFingerprint } from "./fingerprint.js";
import {
  restartGateway,
  startGateway,
  verifyAgentConversation,
  verifyGatewayConnectivity
} from "./gateway.js";
import { fixPathAndRetryVersion, installOpenClaw, readOpenClawVersion } from "./install.js";
import { Logger } from "./logger.js";
import { collectModelConfig } from "./model.js";
import { runOnboardGuide } from "./onboard.js";
import { advancePhase, clearSetupState, readSetupState, saveSetupState } from "./state.js";
import type { CliOptions, SessionPayload, SessionResponse, SetupPhase, SetupState } from "./types.js";
import type { OpenClawConfig } from "./types.js";

const phaseOrder: Record<SetupPhase, number> = {
  init: 0,
  license_validated: 1,
  installed: 2,
  onboarded: 3,
  configured: 4,
  gateway_verified: 5,
  completed: 6
};

function hasReached(current: SetupPhase, target: SetupPhase): boolean {
  return phaseOrder[current] >= phaseOrder[target];
}

async function sendEventSafe(
  api: ApiClient,
  state: SetupState,
  stage: SetupPhase | "error",
  status: "started" | "succeeded" | "failed",
  message?: string,
  errorCode?: string
): Promise<void> {
  await api.sendEvent({
    sessionId: state.sessionId,
    resumeToken: state.resumeToken,
    event: {
      stage,
      status,
      message,
      errorCode
    }
  });
}

function assertSessionResponse(response: SessionResponse): SessionPayload {
  if (!response?.ok || !response.payload?.sessionId || !response.payload?.resumeToken) {
    throw new AppError(ErrorCodes.SESSION_INVALID, "Session API returned invalid payload.");
  }
  return response.payload;
}

function getApiBase(options: CliOptions): string {
  const apiBase = options.apiBase ?? process.env.FAST_OPENCLAW_API_BASE;
  if (!apiBase || !apiBase.trim()) {
    throw new AppError(
      ErrorCodes.API_BASE_MISSING,
      "Missing API base. Pass --api-base or set FAST_OPENCLAW_API_BASE."
    );
  }
  return apiBase;
}

function assertPlatform(): void {
  if (process.platform !== "darwin") {
    throw new AppError(
      ErrorCodes.PLATFORM_NOT_SUPPORTED,
      `This installer currently supports macOS only. Current platform: ${process.platform}`
    );
  }
}

async function resolveSession(
  api: ApiClient,
  options: CliOptions,
  fingerprintHash: string,
  cliVersion: string,
  logger: Logger
): Promise<SessionPayload> {
  if (options.resume?.trim()) {
    logger.info("Resuming setup with resume token...");
    const response = await api.resumeSession({
      resumeToken: options.resume.trim(),
      deviceFingerprint: fingerprintHash,
      cliVersion,
      platform: process.platform
    });
    return assertSessionResponse(response);
  }

  const licenseKey = await password({
    message: "Enter one-time license key",
    mask: "*",
    validate: (value) => (value.trim() ? true : "License key is required")
  });

  const response = await api.startSession({
    licenseKey: licenseKey.trim(),
    deviceFingerprint: fingerprintHash,
    cliVersion,
    platform: process.platform
  });
  return assertSessionResponse(response);
}

async function run(): Promise<void> {
  const program = new Command();
  program
    .name("fast-openclaw")
    .description("One-click OpenClaw setup for macOS")
    .option("--api-base <url>", "override FAST_OPENCLAW_API_BASE")
    .option("--resume <token>", "resume previous setup flow")
    .option("--debug", "enable debug logs")
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  const logger = new Logger(Boolean(options.debug));

  assertPlatform();

  const apiBase = getApiBase(options);
  const api = new ApiClient(apiBase);
  const cliVersion = process.env.npm_package_version ?? "0.1.0";

  const fingerprint = await buildDeviceFingerprint();
  logger.debug(`Device fingerprint hash: ${fingerprint.hash}`);

  const payload = await resolveSession(api, options, fingerprint.hash, cliVersion, logger);

  let state = (await readSetupState()) ?? {
    sessionId: payload.sessionId,
    resumeToken: payload.resumeToken,
    phase: "init" as const,
    deviceFingerprintHash: fingerprint.hash,
    updatedAt: new Date().toISOString()
  };

  state = {
    ...state,
    sessionId: payload.sessionId,
    resumeToken: payload.resumeToken,
    deviceFingerprintHash: fingerprint.hash,
    updatedAt: new Date().toISOString()
  };

  await saveSetupState(state);

  try {
    if (!hasReached(state.phase, "license_validated")) {
      await sendEventSafe(api, state, "license_validated", "started");
      state = await advancePhase(state, "license_validated");
      await sendEventSafe(api, state, "license_validated", "succeeded");
      logger.success("License validated.");
    }

    if (!hasReached(state.phase, "installed")) {
      await sendEventSafe(api, state, "installed", "started");
      let version = await readOpenClawVersion();
      if (!version) {
        await installOpenClaw(logger);
        version = (await readOpenClawVersion()) ?? (await fixPathAndRetryVersion(logger));
      }
      state = await advancePhase(state, "installed", { openclawVersion: version });
      await sendEventSafe(api, state, "installed", "succeeded", `openclaw=${version}`);
      logger.success(`OpenClaw version detected: ${version}`);
    }

    if (!hasReached(state.phase, "onboarded")) {
      await sendEventSafe(api, state, "onboarded", "started");
      await runOnboardGuide(logger);
      state = await advancePhase(state, "onboarded");
      await sendEventSafe(api, state, "onboarded", "succeeded");
      logger.success("Onboard wizard completed.");
    }

    if (!hasReached(state.phase, "configured")) {
      await sendEventSafe(api, state, "configured", "started");
      const modelResult = await collectModelConfig(payload.modelSchema);

      const browser = await buildBrowserConfigPatch();
      if (browser.enabled) {
        logger.success(browser.message);
      } else {
        logger.warn(browser.message);
      }

      const patch: Partial<OpenClawConfig> = {
        models: modelResult.modelsConfig
      };

      if (browser.patch?.browser) {
        patch.browser = browser.patch.browser;
      }

      await mergeAndWriteConfig(patch);
      state = await advancePhase(state, "configured", {
        modelId: modelResult.modelId,
        browserEnabled: browser.enabled
      });
      await sendEventSafe(api, state, "configured", "succeeded", `model=${modelResult.modelId}`);
      logger.success(`Configuration written. Model preset: ${modelResult.modelName}`);
    }

    if (!hasReached(state.phase, "gateway_verified")) {
      await sendEventSafe(api, state, "gateway_verified", "started");
      await startGateway(logger);

      const gatewayUrl = await verifyGatewayConnectivity(
        logger,
        payload.gatewayDefaults?.url,
        payload.gatewayDefaults?.token
      );

      if (state.browserEnabled) {
        await restartGateway(logger);
      }

      await verifyAgentConversation(logger);

      state = await advancePhase(state, "gateway_verified", { gatewayUrl });
      await sendEventSafe(api, state, "gateway_verified", "succeeded", gatewayUrl);
    }

    await api.completeSession({
      sessionId: state.sessionId,
      resumeToken: state.resumeToken,
      resultSummary: {
        openclawVersion: state.openclawVersion ?? "unknown",
        gatewayUrl: state.gatewayUrl ?? "http://localhost:18789",
        browserEnabled: Boolean(state.browserEnabled),
        modelId: state.modelId ?? "unknown"
      }
    });

    state = await advancePhase(state, "completed");
    await sendEventSafe(api, state, "completed", "succeeded", "setup completed");
    await clearSetupState();
    logger.success("Setup completed and license burned.");
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(ErrorCodes.UNKNOWN, "Unexpected error during setup.", error);

    logger.error(`${appError.code}: ${appError.message}`);
    await sendEventSafe(api, state, "error", "failed", appError.message, appError.code);

    logger.warn(
      `Setup interrupted. You can resume using: fast-openclaw --resume ${state.resumeToken}`
    );
    process.exitCode = 1;
  }
}

void run().catch((error) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(ErrorCodes.UNKNOWN, "Unexpected top-level error.", error);
  console.error(`[fast-openclaw] ${appError.code}: ${appError.message}`);
  process.exitCode = 1;
});
