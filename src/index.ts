#!/usr/bin/env node
import { confirm, password, select } from "@inquirer/prompts";
import { Command } from "commander";
import { ApiClient } from "./api.js";
import { buildBrowserConfigPatch } from "./browser.js";
import { readOpenClawConfig, mergeAndWriteConfig, syncDefaultAgentModel } from "./config.js";
import { buildDoctorHints } from "./doctor.js";
import { AppError, ErrorCodes } from "./errors.js";
import { buildDeviceFingerprint } from "./fingerprint.js";
import {
  restartGateway,
  startGateway,
  verifyAgentConversation,
  verifyGatewayConnectivity
} from "./gateway.js";
import {
  fixPathAndRetryVersion,
  installOpenClaw,
  readOpenClawVersion,
  resetOpenClawState
} from "./install.js";
import { Logger } from "./logger.js";
import { resolvePrimaryModelTarget, testModelConnectivity } from "./model-test.js";
import { collectModelConfig } from "./model.js";
import { runOnboardGuide } from "./onboard.js";
import { advancePhase, clearSetupState, readSetupState, saveSetupState } from "./state.js";
import {
  configureOpenClawTelegram,
  discoverChatCandidates,
  getBotTokenFromInput,
  selectChatId,
  sendTelegramTestMessage,
  verifyTelegramWeakSignals,
  validateBotToken
} from "./telegram.js";
import type { CliOptions, SessionPayload, SessionResponse, SetupPhase, SetupState } from "./types.js";
import type { OpenClawConfig } from "./types.js";

const phaseOrder: Record<SetupPhase, number> = {
  init: 0,
  license_validated: 1,
  installed: 2,
  onboarded: 3,
  configured: 4,
  model_verified: 5,
  gateway_verified: 6,
  telegram_bound: 7,
  completed: 8
};

const testOnlyValues = ["model", "gateway", "telegram", "all"] as const;

type TestOnlyValue = (typeof testOnlyValues)[number];
type DoctorAction = "model" | "gateway" | "telegram" | "telegram-weak" | "all" | "exit";

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

function parseTestOnly(value: string | undefined): CliOptions["testOnly"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!testOnlyValues.includes(normalized as TestOnlyValue)) {
    throw new AppError(
      ErrorCodes.CONFIG_VALIDATION_FAILED,
      `Invalid --test-only value: ${value}. Allowed: ${testOnlyValues.join(", ")}.`
    );
  }

  return normalized as CliOptions["testOnly"];
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

async function runModelSectionTest(logger: Logger): Promise<void> {
  const config = await readOpenClawConfig();
  if (!config.models) {
    throw new AppError(
      ErrorCodes.MODEL_TEST_FAILED,
      "~/.openclaw/openclaw.json missing models config. Configure model first."
    );
  }

  await testModelConnectivity(config.models, logger);
}

async function runGatewaySectionTest(
  logger: Logger,
  gatewayDefaults?: { url?: string; token?: string }
): Promise<string> {
  await startGateway(logger);
  const gatewayUrl = await verifyGatewayConnectivity(logger, gatewayDefaults?.url, gatewayDefaults?.token);
  await verifyAgentConversation(logger);
  return gatewayUrl;
}

async function runTelegramSectionTest(
  logger: Logger,
  options: Pick<CliOptions, "telegramBotToken" | "telegramChatId">,
  state?: Pick<SetupState, "telegramChatId">,
  requireWeakValidation = false
): Promise<string> {
  const botToken = await getBotTokenFromInput(options.telegramBotToken);
  await validateBotToken(botToken, logger);

  let chatId = options.telegramChatId?.trim() ?? "";
  if (!chatId && state?.telegramChatId?.trim()) {
    chatId = state.telegramChatId.trim();
    logger.info(`Reusing previously discovered Telegram chat id: ${chatId}`);
  }

  if (!chatId) {
    const candidates = await discoverChatCandidates(botToken, logger);
    chatId = await selectChatId(candidates);
  }

  await configureOpenClawTelegram(botToken, logger);
  await sendTelegramTestMessage(botToken, chatId, logger);

  if (requireWeakValidation) {
    await verifyTelegramWeakSignals(botToken, chatId, logger);
  }

  return chatId;
}

async function runStandaloneTests(logger: Logger, options: CliOptions): Promise<void> {
  if (!options.testOnly) {
    return;
  }

  logger.info(`Running standalone test: ${options.testOnly}`);

  if (options.testOnly === "model") {
    await runModelSectionTest(logger);
    return;
  }

  if (options.testOnly === "gateway") {
    const gatewayUrl = await runGatewaySectionTest(logger);
    logger.success(`Gateway stage test passed: ${gatewayUrl}`);
    return;
  }

  if (options.testOnly === "telegram") {
    const chatId = await runTelegramSectionTest(logger, options);
    logger.success(`Telegram stage test passed (chat ${chatId}).`);
    return;
  }

  await runModelSectionTest(logger);
  const gatewayUrl = await runGatewaySectionTest(logger);
  logger.success(`Gateway stage test passed: ${gatewayUrl}`);
  const chatId = await runTelegramSectionTest(logger, options);
  logger.success(`Telegram stage test passed (chat ${chatId}).`);
}

function normalizeAppError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError(ErrorCodes.UNKNOWN, "Unexpected error during diagnostics.", error);
}

async function runDoctorAction(
  action: DoctorAction,
  logger: Logger,
  options: CliOptions
): Promise<void> {
  const state = (await readSetupState()) ?? undefined;

  if (action === "model") {
    await runModelSectionTest(logger);
    logger.success("Model diagnostics passed.");
    return;
  }

  if (action === "gateway") {
    const gatewayUrl = await runGatewaySectionTest(logger);
    logger.success(`Gateway diagnostics passed: ${gatewayUrl}`);
    return;
  }

  if (action === "telegram") {
    const chatId = await runTelegramSectionTest(logger, options, state);
    logger.success(`Telegram diagnostics passed (chat ${chatId}).`);
    return;
  }

  if (action === "telegram-weak") {
    const chatId = await runTelegramSectionTest(logger, options, state, true);
    logger.success(`Telegram weak diagnostics passed (chat ${chatId}).`);
    return;
  }

  await runModelSectionTest(logger);
  const gatewayUrl = await runGatewaySectionTest(logger);
  logger.success(`Gateway diagnostics passed: ${gatewayUrl}`);
  const chatId = await runTelegramSectionTest(logger, options, state);
  logger.success(`Telegram diagnostics passed (chat ${chatId}).`);
}

async function runDoctorMode(logger: Logger, options: CliOptions): Promise<void> {
  logger.info("Doctor mode enabled. Choose a check to locate setup issues.");

  let keepRunning = true;
  while (keepRunning) {
    const action = await select<DoctorAction>({
      message: "Select a diagnostic check",
      choices: [
        { name: "Model check", value: "model" },
        { name: "Gateway check", value: "gateway" },
        { name: "Telegram check (token + sendMessage)", value: "telegram" },
        { name: "Telegram weak validation (你是谁 + /model)", value: "telegram-weak" },
        { name: "Full chain (model -> gateway -> telegram)", value: "all" },
        { name: "Exit", value: "exit" }
      ]
    });

    if (action === "exit") {
      logger.info("Doctor mode finished.");
      return;
    }

    try {
      await runDoctorAction(action, logger, options);
    } catch (error) {
      const appError = normalizeAppError(error);
      logger.error(`${appError.code}: ${appError.message}`);

      const hintBundle = buildDoctorHints(appError);
      logger.warn(hintBundle.summary);
      for (const hint of hintBundle.hints) {
        logger.warn(`- ${hint}`);
      }
    }

    keepRunning = await confirm({
      message: "Run another diagnostic check?",
      default: true
    });
  }

  logger.info("Doctor mode finished.");
}

async function run(): Promise<void> {
  const program = new Command();
  program
    .name("fast-openclaw")
    .description("One-click OpenClaw setup for macOS")
    .option("--api-base <url>", "override FAST_OPENCLAW_API_BASE")
    .option("--resume <token>", "resume previous setup flow")
    .option("--skip-openclaw-reset", "skip full OpenClaw reset before onboarding")
    .option("--telegram-bot-token <token>", "telegram bot token (skip prompt)")
    .option("--telegram-chat-id <id>", "telegram chat id (skip discovery)")
    .option("--skip-telegram-bind", "skip telegram bind step (debug only)")
    .option("--test-only <section>", "run standalone checks: model|gateway|telegram|all")
    .option("--doctor", "interactive diagnostics menu for model/gateway/telegram checks")
    .option("--debug", "enable debug logs")
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  options.testOnly = parseTestOnly(options.testOnly);

  const logger = new Logger(Boolean(options.debug));

  assertPlatform();

  if (options.doctor && options.testOnly) {
    throw new AppError(
      ErrorCodes.CONFIG_VALIDATION_FAILED,
      "Use either --doctor or --test-only, not both."
    );
  }

  if (options.testOnly) {
    await runStandaloneTests(logger, options);
    return;
  }

  if (options.doctor) {
    await runDoctorMode(logger, options);
    return;
  }

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

      if (!options.skipOpenclawReset) {
        await resetOpenClawState(logger);
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
      const selectedTarget = resolvePrimaryModelTarget(modelResult.modelsConfig);
      await syncDefaultAgentModel(selectedTarget.providerName, selectedTarget.modelId);
      const selectedModelId = `${selectedTarget.providerName}/${selectedTarget.modelId}`;
      state = await advancePhase(state, "configured", {
        modelId: selectedModelId,
        browserEnabled: browser.enabled
      });
      await sendEventSafe(api, state, "configured", "succeeded", `model=${selectedModelId}`);
      logger.success(`Configuration written. Model preset: ${modelResult.modelName} (${selectedModelId})`);
    }

    if (!hasReached(state.phase, "model_verified")) {
      await sendEventSafe(api, state, "model_verified", "started");
      await runModelSectionTest(logger);
      state = await advancePhase(state, "model_verified");
      await sendEventSafe(api, state, "model_verified", "succeeded", "model connectivity verified");
    }

    if (!hasReached(state.phase, "gateway_verified")) {
      await sendEventSafe(api, state, "gateway_verified", "started");
      const gatewayUrl = await runGatewaySectionTest(logger, payload.gatewayDefaults);

      if (state.browserEnabled) {
        await restartGateway(logger);
      }

      state = await advancePhase(state, "gateway_verified", { gatewayUrl });
      await sendEventSafe(api, state, "gateway_verified", "succeeded", gatewayUrl);
      logger.success(`Gateway stage passed: ${gatewayUrl}`);
    }

    if (!hasReached(state.phase, "telegram_bound")) {
      await sendEventSafe(api, state, "telegram_bound", "started");

      if (options.skipTelegramBind) {
        logger.warn("Skipping Telegram bind due to --skip-telegram-bind (debug only).");
        state = await advancePhase(state, "telegram_bound");
        await sendEventSafe(api, state, "telegram_bound", "succeeded", "skipped by debug flag");
      } else {
        const chatId = await runTelegramSectionTest(logger, options, state, true);
        state = await advancePhase(state, "telegram_bound", {
          telegramChatId: chatId,
          telegramBoundAt: new Date().toISOString()
        });
        await sendEventSafe(api, state, "telegram_bound", "succeeded", "telegram channel verified");
        logger.success(`Telegram channel verified (chat ${chatId}).`);
      }
    }

    await api.completeSession({
      sessionId: state.sessionId,
      resumeToken: state.resumeToken,
      resultSummary: {
        openclawVersion: state.openclawVersion ?? "unknown",
        gatewayUrl: state.gatewayUrl ?? "http://localhost:18789",
        browserEnabled: Boolean(state.browserEnabled),
        modelId: state.modelId ?? "unknown",
        telegramChatId: state.telegramChatId
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

    logger.warn(`Setup interrupted. Resume token: ${state.resumeToken}`);
    logger.warn(`Resume command (global): fast-openclaw --resume ${state.resumeToken}`);
    logger.warn(`Resume command (npx): npx @your-scope/fast-openclaw --resume ${state.resumeToken}`);
    logger.warn(`Resume command (repo dev): npm run dev -- --resume ${state.resumeToken}`);
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
