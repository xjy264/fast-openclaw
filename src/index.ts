#!/usr/bin/env node
import crypto from "node:crypto";
import { confirm, password, select } from "@inquirer/prompts";
import { Command } from "commander";
import { ApiClient } from "./api.js";
import { buildBrowserConfigPatch } from "./browser.js";
import { readOpenClawConfig, mergeAndWriteConfig, syncDefaultAgentModel } from "./config.js";
import { SETUP_STATE_PATH } from "./constants.js";
import {
  collectDingtalkConfigInput,
  configureOpenClawDingtalk,
  verifyDingtalkConfigured
} from "./dingtalk.js";
import { buildDoctorHints } from "./doctor.js";
import { AppError, ErrorCodes } from "./errors.js";
import { buildDeviceFingerprint } from "./fingerprint.js";
import {
  ensureGatewayServiceReady,
  normalizeGatewayTokenValue,
  restartGateway,
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
import { collectModelConfig, validateModelsConfig } from "./model.js";
import { advancePhase, clearSetupState, readSetupState, saveSetupState } from "./state.js";
import {
  configureOpenClawTelegram,
  getBotTokenFromInput,
  getChatIdFromInput,
  sendTelegramTestMessage,
  verifyTelegramWeakSignals,
  validateBotToken
} from "./telegram.js";
import type {
  ChannelType,
  CliOptions,
  SessionPayload,
  SessionResponse,
  SetupPhase,
  SetupState
} from "./types.js";
import type { OpenClawConfig } from "./types.js";

const phaseOrder: Record<SetupPhase, number> = {
  init: 0,
  license_validated: 1,
  installed: 2,
  configured: 3,
  model_verified: 4,
  gateway_verified: 5,
  channel_bound: 6,
  completed: 7
};

const testOnlyValues = ["model", "gateway", "telegram", "dingtalk", "all"] as const;

type TestOnlyValue = (typeof testOnlyValues)[number];
type DoctorAction = "model" | "gateway" | "telegram" | "telegram-weak" | "dingtalk" | "all" | "exit";

function hasReached(current: SetupPhase, target: SetupPhase): boolean {
  return phaseOrder[current] >= phaseOrder[target];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readGatewayTokenFromConfig(config: OpenClawConfig): string {
  const gateway = asRecord(config.gateway);
  const auth = asRecord(gateway.auth);
  return asString(auth.token) || asString(gateway.token);
}

function buildGatewayToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function isKnownSetupPhase(phase: string): phase is SetupPhase {
  return Object.hasOwn(phaseOrder, phase);
}

async function ensureGatewayBaselineConfig(
  logger: Logger,
  tokenFromServer?: string
): Promise<string> {
  const current = await readOpenClawConfig();
  const existingToken = readGatewayTokenFromConfig(current);
  const preferredToken =
    tokenFromServer?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.FAST_OPENCLAW_GATEWAY_TOKEN?.trim() ||
    existingToken ||
    buildGatewayToken();
  const normalizedToken = normalizeGatewayTokenValue(preferredToken, buildGatewayToken);
  const gatewayToken = normalizedToken.token;

  if (!existingToken && !tokenFromServer && !process.env.OPENCLAW_GATEWAY_TOKEN && !process.env.FAST_OPENCLAW_GATEWAY_TOKEN) {
    logger.warn("未检测到现有网关 token，已自动生成并写入本地配置。");
  } else if (normalizedToken.replaced) {
    logger.warn("检测到占位网关 token，已自动替换为新 token。");
  }

  await mergeAndWriteConfig({
    gateway: {
      mode: "local",
      bind: "loopback",
      port: 18789,
      token: gatewayToken,
      auth: {
        mode: "token",
        token: gatewayToken
      }
    }
  });

  logger.info("已写入网关基础配置（local + loopback + token）。");
  return gatewayToken;
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
    throw new AppError(ErrorCodes.SESSION_INVALID, "会话 API 返回了无效载荷。");
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
      `无效的 --test-only 参数：${value}。可选值：${testOnlyValues.join(", ")}。`
    );
  }

  return normalized as CliOptions["testOnly"];
}

function parseChannel(value: string | undefined): CliOptions["channel"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "telegram" || normalized === "dingtalk") {
    return normalized;
  }

  throw new AppError(
    ErrorCodes.CONFIG_VALIDATION_FAILED,
    `无效的 --channel 参数：${value}。可选值：telegram, dingtalk。`
  );
}

async function resolveSelectedChannel(channel?: ChannelType): Promise<ChannelType> {
  if (channel) {
    return channel;
  }

  return select<ChannelType>({
    message: "请选择要绑定的渠道",
    choices: [
      { name: "Telegram", value: "telegram" },
      { name: "钉钉", value: "dingtalk" }
    ]
  });
}

function getApiBase(options: CliOptions): string {
  const apiBase = options.apiBase ?? process.env.FAST_OPENCLAW_API_BASE;
  if (!apiBase || !apiBase.trim()) {
    throw new AppError(
      ErrorCodes.API_BASE_MISSING,
      "缺少 API base。请传入 --api-base，或设置 FAST_OPENCLAW_API_BASE。"
    );
  }
  return apiBase;
}

function assertPlatform(): void {
  if (process.platform !== "darwin") {
    throw new AppError(
      ErrorCodes.PLATFORM_NOT_SUPPORTED,
      `当前安装器仅支持 macOS。当前平台：${process.platform}`
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
    logger.info("正在使用恢复令牌（resume token）恢复安装流程...");
    const response = await api.resumeSession({
      resumeToken: options.resume.trim(),
      deviceFingerprint: fingerprintHash,
      cliVersion,
      platform: process.platform
    });
    return assertSessionResponse(response);
  }

  const licenseKey = await password({
    message: "请输入一次性许可密钥（License Key）",
    mask: "*",
    validate: (value) => (value.trim() ? true : "许可密钥不能为空")
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
      "~/.openclaw/openclaw.json 缺少 models 配置，请先完成模型配置。"
    );
  }

  await testModelConnectivity(config.models, logger);
}

async function runGatewaySectionTest(
  logger: Logger,
  gatewayDefaults?: { url?: string; token?: string }
): Promise<string> {
  await ensureGatewayServiceReady(logger);
  const gatewayUrl = await verifyGatewayConnectivity(logger, gatewayDefaults?.url, gatewayDefaults?.token);
  return gatewayUrl;
}

async function runTelegramSectionTest(
  logger: Logger,
  options: Pick<CliOptions, "telegramBotToken" | "telegramChatId">,
  requireWeakValidation = false
): Promise<string> {
  const botToken = await getBotTokenFromInput(options.telegramBotToken);
  await validateBotToken(botToken, logger);
  const chatId = await getChatIdFromInput(options.telegramChatId);

  await configureOpenClawTelegram(botToken, logger);
  await sendTelegramTestMessage(botToken, chatId, logger);

  if (requireWeakValidation) {
    await verifyTelegramWeakSignals(botToken, chatId, logger);
  }

  return chatId;
}

async function runDingtalkSectionTest(
  logger: Logger,
  options: Pick<
    CliOptions,
    "dingtalkClientId" | "dingtalkClientSecret" | "dingtalkRobotCode" | "dingtalkCorpId" | "dingtalkAgentId"
  >
): Promise<void> {
  const dingtalkInput = await collectDingtalkConfigInput(options);
  await configureOpenClawDingtalk(dingtalkInput, logger);
  await verifyDingtalkConfigured(logger);
}

async function ensureModelGuardAfterChannel(logger: Logger, selectedModelId?: string): Promise<void> {
  if (!selectedModelId?.trim()) {
    return;
  }

  const modelTarget = selectedModelId.trim();
  const separator = modelTarget.indexOf("/");
  if (separator <= 0 || separator >= modelTarget.length - 1) {
    logger.warn(`跳过模型防护同步：无效 modelId=${modelTarget}`);
    return;
  }

  const providerName = modelTarget.slice(0, separator);
  const modelId = modelTarget.slice(separator + 1);

  const config = await readOpenClawConfig();
  if (config.models) {
    validateModelsConfig(config.models);
  }
  await syncDefaultAgentModel(providerName, modelId);
  logger.info(`渠道配置后已重新同步默认模型：${providerName}/${modelId}`);
}

async function runStandaloneTests(logger: Logger, options: CliOptions): Promise<void> {
  if (!options.testOnly) {
    return;
  }

  logger.info(`正在执行独立测试：${options.testOnly}`);

  if (options.testOnly === "model") {
    await runModelSectionTest(logger);
    return;
  }

  if (options.testOnly === "gateway") {
    const gatewayUrl = await runGatewaySectionTest(logger);
    logger.success(`网关阶段测试通过：${gatewayUrl}`);
    return;
  }

  if (options.testOnly === "telegram") {
    const chatId = await runTelegramSectionTest(logger, options);
    logger.success(`Telegram 阶段测试通过（会话 ${chatId}）。`);
    return;
  }

  if (options.testOnly === "dingtalk") {
    const gatewayUrl = await runGatewaySectionTest(logger);
    logger.success(`网关阶段测试通过：${gatewayUrl}`);
    await runDingtalkSectionTest(logger, options);
    logger.success("钉钉阶段测试通过。");
    return;
  }

  await runModelSectionTest(logger);
  const gatewayUrl = await runGatewaySectionTest(logger);
  logger.success(`网关阶段测试通过：${gatewayUrl}`);
  const selectedChannel = await resolveSelectedChannel(options.channel);

  if (selectedChannel === "telegram") {
    const chatId = await runTelegramSectionTest(logger, options);
    logger.success(`Telegram 阶段测试通过（会话 ${chatId}）。`);
    return;
  }

  await runDingtalkSectionTest(logger, options);
  logger.success("钉钉阶段测试通过。");
}

function normalizeAppError(error: unknown): AppError {
  return error instanceof AppError
    ? error
    : new AppError(ErrorCodes.UNKNOWN, "诊断流程发生未预期错误。", error);
}

async function runDoctorAction(
  action: DoctorAction,
  logger: Logger,
  options: CliOptions
): Promise<void> {
  if (action === "model") {
    await runModelSectionTest(logger);
    logger.success("模型诊断通过。");
    return;
  }

  if (action === "gateway") {
    const gatewayUrl = await runGatewaySectionTest(logger);
    logger.success(`网关诊断通过：${gatewayUrl}`);
    return;
  }

  if (action === "telegram") {
    const chatId = await runTelegramSectionTest(logger, options);
    logger.success(`Telegram 诊断通过（会话 ${chatId}）。`);
    return;
  }

  if (action === "telegram-weak") {
    const chatId = await runTelegramSectionTest(logger, options, true);
    logger.success(`Telegram 弱校验诊断通过（会话 ${chatId}）。`);
    return;
  }

  if (action === "dingtalk") {
    const gatewayUrl = await runGatewaySectionTest(logger);
    logger.success(`网关诊断通过：${gatewayUrl}`);
    await runDingtalkSectionTest(logger, options);
    logger.success("钉钉诊断通过。");
    return;
  }

  await runModelSectionTest(logger);
  const gatewayUrl = await runGatewaySectionTest(logger);
  logger.success(`网关诊断通过：${gatewayUrl}`);
  const selectedChannel = await resolveSelectedChannel(options.channel);

  if (selectedChannel === "telegram") {
    const chatId = await runTelegramSectionTest(logger, options);
    logger.success(`Telegram 诊断通过（会话 ${chatId}）。`);
    return;
  }

  await runDingtalkSectionTest(logger, options);
  logger.success("钉钉诊断通过。");
}

async function runDoctorMode(logger: Logger, options: CliOptions): Promise<void> {
  logger.info("已进入诊断模式（doctor），请选择检查项来定位问题。");

  let keepRunning = true;
  while (keepRunning) {
    const action = await select<DoctorAction>({
      message: "请选择诊断检查项",
      choices: [
        { name: "模型检查", value: "model" },
        { name: "网关检查", value: "gateway" },
        { name: "Telegram 检查（token + sendMessage）", value: "telegram" },
        { name: "Telegram 弱校验（你是谁 + /model）", value: "telegram-weak" },
        { name: "钉钉检查（插件 + 配置）", value: "dingtalk" },
        { name: "全链路检查（model -> gateway -> channel）", value: "all" },
        { name: "退出", value: "exit" }
      ]
    });

    if (action === "exit") {
      logger.info("诊断模式已结束。");
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
      message: "是否继续执行其他诊断检查？",
      default: true
    });
  }

  logger.info("诊断模式已结束。");
}

async function run(): Promise<void> {
  const program = new Command();
  program
    .name("fast-openclaw")
    .description("macOS 一键配置 OpenClaw")
    .option("--api-base <url>", "覆盖 FAST_OPENCLAW_API_BASE")
    .option("--resume <token>", "恢复上一次中断的配置流程")
    .option("--channel <type>", "渠道类型：telegram|dingtalk")
    .option("--skip-openclaw-reset", "跳过引导前的 OpenClaw 全量重置")
    .option("--telegram-bot-token <token>", "Telegram Bot Token（跳过交互输入）")
    .option("--telegram-chat-id <id>", "Telegram 会话 ID（跳过交互输入）")
    .option("--dingtalk-client-id <id>", "钉钉 clientId（跳过交互输入）")
    .option("--dingtalk-client-secret <secret>", "钉钉 clientSecret（跳过交互输入）")
    .option("--dingtalk-robot-code <code>", "钉钉 robotCode（跳过交互输入）")
    .option("--dingtalk-corp-id <id>", "钉钉 corpId（跳过交互输入）")
    .option("--dingtalk-agent-id <id>", "钉钉 agentId（跳过交互输入）")
    .option("--skip-telegram-bind", "跳过 Telegram 绑定步骤（仅调试）")
    .option("--test-only <section>", "仅执行分段测试：model|gateway|telegram|dingtalk|all")
    .option("--doctor", "进入交互式诊断菜单（model/gateway/channel）")
    .option("--debug", "开启调试日志")
    .parse(process.argv);

  const options = program.opts<CliOptions>();
  options.testOnly = parseTestOnly(options.testOnly);
  options.channel = parseChannel(options.channel);

  const logger = new Logger(Boolean(options.debug));

  assertPlatform();

  if (options.doctor && options.testOnly) {
    throw new AppError(
      ErrorCodes.CONFIG_VALIDATION_FAILED,
      "不能同时使用 --doctor 和 --test-only，请二选一。"
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
  logger.debug(`设备指纹哈希：${fingerprint.hash}`);

  const payload = await resolveSession(api, options, fingerprint.hash, cliVersion, logger);

  let existingState = await readSetupState();
  let existingPhase = asString((existingState as { phase?: unknown } | null)?.phase);

  if (existingState && existingPhase === "telegram_bound") {
    existingState = {
      ...existingState,
      phase: "channel_bound",
      channelType: "telegram",
      channelBoundAt: existingState.channelBoundAt ?? existingState.telegramBoundAt
    };
    await saveSetupState(existingState);
    existingPhase = "channel_bound";
  }

  if (options.resume?.trim() && existingPhase === "onboarded") {
    throw new AppError(
      ErrorCodes.CONFIG_VALIDATION_FAILED,
      `检测到旧版状态文件 phase=onboarded。当前版本已移除该阶段，请先删除 ${SETUP_STATE_PATH} 后重试。`
    );
  }

  if (existingState && existingPhase && !isKnownSetupPhase(existingPhase)) {
    throw new AppError(
      ErrorCodes.CONFIG_VALIDATION_FAILED,
      `检测到无法识别的状态阶段：${existingPhase}。请删除 ${SETUP_STATE_PATH} 后重新运行。`
    );
  }

  let state = existingState ?? {
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
      logger.success("许可密钥校验通过。");
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

      await ensureGatewayBaselineConfig(logger, payload.gatewayDefaults?.token);

      state = await advancePhase(state, "installed", { openclawVersion: version });
      await sendEventSafe(api, state, "installed", "succeeded", `openclaw=${version}`);
      logger.success(`已检测到 OpenClaw 版本：${version}`);
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
      logger.success(`配置已写入。当前模型预设：${modelResult.modelName}（${selectedModelId}）`);
    }

    if (!hasReached(state.phase, "model_verified")) {
      await sendEventSafe(api, state, "model_verified", "started");
      await runModelSectionTest(logger);
      state = await advancePhase(state, "model_verified");
      await sendEventSafe(api, state, "model_verified", "succeeded", "模型连通性校验通过");
    }

    if (!hasReached(state.phase, "gateway_verified")) {
      await sendEventSafe(api, state, "gateway_verified", "started");
      const gatewayUrl = await runGatewaySectionTest(logger, payload.gatewayDefaults);

      if (state.browserEnabled) {
        await restartGateway(logger);
      }

      state = await advancePhase(state, "gateway_verified", { gatewayUrl });
      await sendEventSafe(api, state, "gateway_verified", "succeeded", gatewayUrl);
      logger.success(`网关阶段通过：${gatewayUrl}`);
    }

    if (!hasReached(state.phase, "channel_bound")) {
      await sendEventSafe(api, state, "channel_bound", "started");

      if (options.skipTelegramBind) {
        logger.warn("由于 --skip-telegram-bind，已跳过渠道绑定（仅调试）。");
        state = await advancePhase(state, "channel_bound");
        await sendEventSafe(api, state, "channel_bound", "succeeded", "调试模式跳过");
      } else {
        const selectedChannel = await resolveSelectedChannel(options.channel);

        if (selectedChannel === "telegram") {
          const chatId = await runTelegramSectionTest(logger, options);
          await ensureModelGuardAfterChannel(logger, state.modelId);
          state = await advancePhase(state, "channel_bound", {
            channelType: "telegram",
            telegramChatId: chatId,
            telegramBoundAt: new Date().toISOString(),
            channelBoundAt: new Date().toISOString()
          });
          await sendEventSafe(api, state, "channel_bound", "succeeded", "channel=telegram");
          logger.success(`Telegram 渠道校验通过（会话 ${chatId}）。`);
        } else {
          await runDingtalkSectionTest(logger, options);
          await ensureModelGuardAfterChannel(logger, state.modelId);
          state = await advancePhase(state, "channel_bound", {
            channelType: "dingtalk",
            telegramChatId: undefined,
            telegramBoundAt: undefined,
            channelBoundAt: new Date().toISOString()
          });
          await sendEventSafe(api, state, "channel_bound", "succeeded", "channel=dingtalk");
          logger.success("钉钉渠道校验通过。");
        }
      }
    }

    await api.completeSession({
      sessionId: state.sessionId,
      resumeToken: state.resumeToken,
      resultSummary: {
        openclawVersion: state.openclawVersion ?? "未知",
        gatewayUrl: state.gatewayUrl ?? "http://localhost:18789",
        browserEnabled: Boolean(state.browserEnabled),
        modelId: state.modelId ?? "未知",
        channelType: state.channelType,
        telegramChatId: state.telegramChatId
      }
    });

    state = await advancePhase(state, "completed");
    await sendEventSafe(api, state, "completed", "succeeded", "配置完成");
    await clearSetupState();
    logger.success("配置流程完成，一次性许可密钥已焚毁。");
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : new AppError(ErrorCodes.UNKNOWN, "配置流程发生未预期错误。", error);

    logger.error(`${appError.code}: ${appError.message}`);
    await sendEventSafe(api, state, "error", "failed", appError.message, appError.code);

    logger.warn(`配置已中断。恢复令牌（resume token）：${state.resumeToken}`);
    logger.warn(`恢复命令（全局）：fast-openclaw --resume ${state.resumeToken}`);
    logger.warn(`恢复命令（npx）：npx @your-scope/fast-openclaw --resume ${state.resumeToken}`);
    logger.warn(`恢复命令（仓库开发模式）：npm run dev -- --resume ${state.resumeToken}`);
    process.exitCode = 1;
  }
}

void run().catch((error) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(ErrorCodes.UNKNOWN, "发生未预期的顶层错误。", error);
  console.error(`[fast-openclaw] ${appError.code}: ${appError.message}`);
  process.exitCode = 1;
});
