import type { ModelOption, ModelSchema } from "./types.js";

type ProviderKey = "openai" | "claude" | "gemini" | "glm" | "kimi";

interface ProviderPreset {
  key: ProviderKey;
  label: string;
  description: string;
  api: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  apiKeyLabel: string;
}

function envValue(key: string): string | undefined {
  const value = process.env[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function providerPreset(
  key: ProviderKey,
  fallback: Omit<ProviderPreset, "key">
): ProviderPreset {
  const upper = key.toUpperCase();
  return {
    key,
    label: envValue(`FAST_OPENCLAW_MODEL_${upper}_LABEL`) ?? fallback.label,
    description: envValue(`FAST_OPENCLAW_MODEL_${upper}_DESCRIPTION`) ?? fallback.description,
    api: envValue(`FAST_OPENCLAW_MODEL_${upper}_API`) ?? fallback.api,
    baseUrl: envValue(`FAST_OPENCLAW_MODEL_${upper}_BASE_URL`) ?? fallback.baseUrl,
    modelId: envValue(`FAST_OPENCLAW_MODEL_${upper}_MODEL_ID`) ?? fallback.modelId,
    modelName: envValue(`FAST_OPENCLAW_MODEL_${upper}_MODEL_NAME`) ?? fallback.modelName,
    apiKeyLabel: fallback.apiKeyLabel
  };
}

function buildOption(preset: ProviderPreset): ModelOption {
  const apiKeyDefault =
    envValue(`FAST_OPENCLAW_MODEL_${preset.key.toUpperCase()}_API_KEY`) ??
    envValue("FAST_OPENCLAW_MODEL_API_KEY");

  return {
    id: preset.key,
    name: preset.label,
    description: preset.description,
    configTemplate: {
      mode: "merge",
      providers: {
        [preset.key]: {
          baseUrl: preset.baseUrl,
          apiKey: "{{apiKey}}",
          api: preset.api,
          models: [
            {
              id: preset.modelId,
              name: preset.modelName
            }
          ]
        }
      }
    },
    fields: [
      {
        key: "apiKey",
        label: preset.apiKeyLabel,
        type: "password",
        required: true,
        default: apiKeyDefault
      }
    ]
  };
}

function buildGlmOption(preset: ProviderPreset): ModelOption {
  const apiKeyDefault =
    envValue(`FAST_OPENCLAW_MODEL_${preset.key.toUpperCase()}_API_KEY`) ??
    envValue("FAST_OPENCLAW_MODEL_API_KEY");

  return {
    id: preset.key,
    name: preset.label,
    description: preset.description,
    configTemplate: {
      mode: "merge",
      providers: {
        [preset.key]: {
          baseUrl: preset.baseUrl,
          apiKey: "{{apiKey}}",
          api: preset.api,
          models: [
            {
              id: preset.modelId,
              name: preset.modelName,
              contextWindow: 128000,
              maxTokens: 4096,
              reasoning: false,
              input: ["text"],
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0
              }
            }
          ]
        }
      }
    },
    fields: [
      {
        key: "apiKey",
        label: preset.apiKeyLabel,
        type: "password",
        required: true,
        default: apiKeyDefault
      }
    ]
  };
}

function orderOptions(options: ModelOption[]): ModelOption[] {
  const preferred = (envValue("FAST_OPENCLAW_MODEL_PROVIDER") ?? "glm").toLowerCase();
  const index = options.findIndex((item) => item.id === preferred);
  if (index <= 0) {
    return options;
  }
  return [options[index], ...options.slice(0, index), ...options.slice(index + 1)];
}

export function buildDefaultModelSchema(): ModelSchema {
  const options = orderOptions([
    buildOption(
      providerPreset("openai", {
        label: "OpenAI",
        description: "OpenAI 官方 API",
        api: "openai-completions",
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-4.1-mini",
        modelName: "gpt-4.1-mini",
        apiKeyLabel: "OpenAI API Key（必填）"
      })
    ),
    buildOption(
      providerPreset("claude", {
        label: "Claude",
        description: "Anthropic 官方 API",
        api: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        modelId: "claude-3-7-sonnet-latest",
        modelName: "claude-3-7-sonnet-latest",
        apiKeyLabel: "Anthropic API Key（必填）"
      })
    ),
    buildOption(
      providerPreset("gemini", {
        label: "Gemini",
        description: "Google Gemini（OpenAI 兼容接口）",
        api: "openai-completions",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        modelId: "gemini-2.0-flash",
        modelName: "gemini-2.0-flash",
        apiKeyLabel: "Gemini API Key（必填）"
      })
    ),
    buildGlmOption(
      providerPreset("glm", {
        label: "GLM",
        description: "智谱 GLM（OpenAI 兼容接口）",
        api: "openai-completions",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        modelId: "glm-4.7",
        modelName: "GLM 4.7",
        apiKeyLabel: "GLM API Key（必填）"
      })
    ),
    buildOption(
      providerPreset("kimi", {
        label: "Kimi",
        description: "Moonshot Kimi（OpenAI 兼容接口）",
        api: "openai-completions",
        baseUrl: "https://api.moonshot.cn/v1",
        modelId: "moonshot-v1-8k",
        modelName: "moonshot-v1-8k",
        apiKeyLabel: "Kimi API Key（必填）"
      })
    )
  ]);

  return {
    mode: "merge",
    options
  };
}
