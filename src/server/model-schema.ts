import type { ModelSchema } from "./types.js";

function providerTemplate(api: string): Record<string, unknown> {
  return {
    mode: "merge",
    providers: {
      custom: {
        baseUrl: "{{baseUrl}}",
        apiKey: "{{apiKey}}",
        api,
        models: [
          {
            id: "{{modelId}}",
            name: "{{modelName}}"
          }
        ]
      }
    }
  };
}

export function buildDefaultModelSchema(): ModelSchema {
  return {
    mode: "merge",
    options: [
      {
        id: "zai/glm-4.5",
        name: "zai/glm-4.5",
        description: "ZAI GLM-4.5 via OpenAI compatible endpoint",
        configTemplate: providerTemplate("openai-completions"),
        fields: [
          { key: "baseUrl", label: "Base URL", type: "string", required: true, default: "https://api.z.ai/api/paas/v4" },
          { key: "apiKey", label: "API Key", type: "password", required: true },
          { key: "modelId", label: "Model ID", type: "string", required: true, default: "zai/glm-4.5" },
          { key: "modelName", label: "Model Name", type: "string", required: true, default: "zai/glm-4.5" }
        ]
      }
    ]
  };
}
