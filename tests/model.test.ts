import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { renderTemplate, validateModelsConfig } from "../src/model.js";

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
