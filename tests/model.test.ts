import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { collectModelConfig, renderTemplate, validateModelsConfig } from "../src/model.js";

const originalModelApiKey = process.env.FAST_OPENCLAW_MODEL_API_KEY;

afterEach(() => {
  if (originalModelApiKey === undefined) {
    delete process.env.FAST_OPENCLAW_MODEL_API_KEY;
  } else {
    process.env.FAST_OPENCLAW_MODEL_API_KEY = originalModelApiKey;
  }
});

describe("renderTemplate", () => {
  it("replaces placeholders in nested object", () => {
    const template = {
      mode: "merge",
      providers: {
        litellm: {
          baseUrl: "{{baseUrl}}",
          apiKey: "{{apiKey}}",
          models: [
            {
              id: "{{modelId}}",
              name: "{{modelName}}"
            }
          ]
        }
      }
    };

    const rendered = renderTemplate(template, {
      baseUrl: "http://localhost:4000",
      apiKey: "k-test",
      modelId: "claude-sonnet-4-6",
      modelName: "claude-sonnet-4-6"
    });

    expect(rendered).toEqual({
      mode: "merge",
      providers: {
        litellm: {
          baseUrl: "http://localhost:4000",
          apiKey: "k-test",
          models: [{ id: "claude-sonnet-4-6", name: "claude-sonnet-4-6" }]
        }
      }
    });
  });
});

describe("validateModelsConfig", () => {
  it("accepts models[] with id and name", () => {
    const config = {
      providers: {
        litellm: {
          models: [{ id: "a", name: "a" }]
        }
      }
    };

    expect(() => validateModelsConfig(config)).not.toThrow();
  });

  it("throws when model entry misses name", () => {
    const config = {
      providers: {
        litellm: {
          models: [{ id: "a" }]
        }
      }
    };

    expect(() => validateModelsConfig(config)).toThrow(AppError);
  });
});

describe("collectModelConfig", () => {
  it("uses first schema option and environment defaults without prompts", async () => {
    process.env.FAST_OPENCLAW_MODEL_API_KEY = "k-from-env";

    const result = await collectModelConfig({
      options: [
        {
          id: "zai/glm-4.7",
          name: "zai/glm-4.7",
          configTemplate: {
            mode: "merge",
            providers: {
              custom: {
                baseUrl: "{{baseUrl}}",
                apiKey: "{{apiKey}}",
                api: "openai-completions",
                models: [{ id: "{{modelId}}", name: "{{modelName}}" }]
              }
            }
          },
          fields: [
            { key: "baseUrl", label: "Base URL", type: "string", required: true, default: "http://127.0.0.1:4010" },
            { key: "apiKey", label: "API Key", type: "password", required: true },
            { key: "modelId", label: "Model ID", type: "string", required: true, default: "zai/glm-4.7" },
            { key: "modelName", label: "Model Name", type: "string", required: true, default: "zai/glm-4.7" }
          ]
        }
      ]
    });

    expect(result.modelId).toBe("zai/glm-4.7");
    expect(result.modelsConfig).toEqual({
      mode: "merge",
      providers: {
        custom: {
          baseUrl: "http://127.0.0.1:4010",
          apiKey: "k-from-env",
          api: "openai-completions",
          models: [{ id: "zai/glm-4.7", name: "zai/glm-4.7" }]
        }
      }
    });
  });

  it("throws when environment override cannot be coerced", async () => {
    process.env.FAST_OPENCLAW_MODEL_PORT = "abc";

    await expect(
      collectModelConfig({
        options: [
          {
            id: "zai/glm-4.7",
            name: "zai/glm-4.7",
            configTemplate: {
              providers: {
                custom: {
                  baseUrl: "http://127.0.0.1:4010",
                  apiKey: "x",
                  api: "openai-completions",
                  models: [{ id: "a", name: "a" }],
                  port: "{{port}}"
                }
              }
            },
            fields: [{ key: "port", label: "Port", type: "number", required: true }]
          }
        ]
      })
    ).rejects.toThrow(AppError);

    delete process.env.FAST_OPENCLAW_MODEL_PORT;
  });
});
