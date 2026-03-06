import { AppError, ErrorCodes } from "./errors.js";
import { Logger } from "./logger.js";

export interface ResolvedModelTarget {
  providerName: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolvePrimaryModelTarget(modelsConfig: unknown): ResolvedModelTarget {
  if (!isObject(modelsConfig) || !isObject(modelsConfig.providers)) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型配置无效：缺少 providers。");
  }

  const providerEntry = Object.entries(modelsConfig.providers).find(([, cfg]) => isObject(cfg));
  if (!providerEntry) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型配置中未找到可用 provider。");
  }

  const [providerName, providerConfigUnknown] = providerEntry;
  const providerConfig = providerConfigUnknown as Record<string, unknown>;
  const baseUrl = asString(providerConfig.baseUrl);
  const apiKey = asString(providerConfig.apiKey);
  const api = asString(providerConfig.api);
  const models = providerConfig.models;

  if (!baseUrl || !apiKey || !api) {
    throw new AppError(
      ErrorCodes.MODEL_TEST_FAILED,
      "模型 provider 配置必须包含 baseUrl、apiKey、api 字段。"
    );
  }

  if (!Array.isArray(models) || models.length === 0 || !isObject(models[0])) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型 provider 配置必须包含 models[0]。");
  }

  const modelId = asString(models[0].id);
  if (!modelId) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型连通性测试需要配置 models[0].id。");
  }

  return {
    providerName,
    api,
    baseUrl,
    apiKey,
    modelId
  };
}

async function callOpenAICompletions(target: ResolvedModelTarget): Promise<void> {
  const endpoint = `${target.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${target.apiKey}`
    },
    body: JSON.stringify({
      model: target.modelId,
      messages: [{ role: "user", content: "Reply with OK" }],
      max_tokens: 8,
      temperature: 0
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new AppError(
      ErrorCodes.MODEL_TEST_FAILED,
      `模型测试失败（${response.status}）：${bodyText || response.statusText}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型测试返回了非 JSON 响应。");
  }

  if (!isObject(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型测试响应缺少 choices。");
  }
}

function buildAnthropicEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
}

async function callAnthropicMessages(target: ResolvedModelTarget): Promise<void> {
  const endpoint = buildAnthropicEndpoint(target.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": target.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: target.modelId,
      max_tokens: 64,
      messages: [{ role: "user", content: "Reply with OK" }]
    })
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new AppError(
      ErrorCodes.MODEL_TEST_FAILED,
      `模型测试失败（${response.status}）：${bodyText || response.statusText}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型测试返回了非 JSON 响应。");
  }

  if (!isObject(parsed) || !Array.isArray(parsed.content) || parsed.content.length === 0) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "模型测试响应缺少 content。");
  }
}

export async function testModelConnectivity(modelsConfig: unknown, logger: Logger): Promise<void> {
  const target = resolvePrimaryModelTarget(modelsConfig);
  logger.info(`正在测试模型连通性（${target.providerName}/${target.modelId}）...`);

  if (target.api === "openai-completions") {
    await callOpenAICompletions(target);
    logger.success("模型连通性测试通过。");
    return;
  }

  if (target.api === "anthropic-messages") {
    await callAnthropicMessages(target);
    logger.success("模型连通性测试通过。");
    return;
  }

  throw new AppError(
    ErrorCodes.MODEL_TEST_FAILED,
    `自动化测试暂不支持该模型 API 类型：${target.api}`
  );
}
