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
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "Invalid models config: providers is missing.");
  }

  const providerEntry = Object.entries(modelsConfig.providers).find(([, cfg]) => isObject(cfg));
  if (!providerEntry) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "No model provider found in models config.");
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
      "Model provider config requires baseUrl, apiKey, and api fields."
    );
  }

  if (!Array.isArray(models) || models.length === 0 || !isObject(models[0])) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "Model provider config requires models[0].");
  }

  const modelId = asString(models[0].id);
  if (!modelId) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "models[0].id is required for model test.");
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
      `Model test failed (${response.status}): ${bodyText || response.statusText}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "Model test returned non-JSON response.");
  }

  if (!isObject(parsed) || !Array.isArray(parsed.choices) || parsed.choices.length === 0) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "Model test response has no choices.");
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
      `Model test failed (${response.status}): ${bodyText || response.statusText}`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "Model test returned non-JSON response.");
  }

  if (!isObject(parsed) || !Array.isArray(parsed.content) || parsed.content.length === 0) {
    throw new AppError(ErrorCodes.MODEL_TEST_FAILED, "Model test response has no content.");
  }
}

export async function testModelConnectivity(modelsConfig: unknown, logger: Logger): Promise<void> {
  const target = resolvePrimaryModelTarget(modelsConfig);
  logger.info(`Testing model connectivity (${target.providerName}/${target.modelId}) ...`);

  if (target.api === "openai-completions") {
    await callOpenAICompletions(target);
    logger.success("Model connectivity test passed.");
    return;
  }

  if (target.api === "anthropic-messages") {
    await callAnthropicMessages(target);
    logger.success("Model connectivity test passed.");
    return;
  }

  throw new AppError(
    ErrorCodes.MODEL_TEST_FAILED,
    `Unsupported model api type for automated test: ${target.api}`
  );
}
