import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors.js";
import { resolvePrimaryModelTarget } from "../src/model-test.js";

describe("resolvePrimaryModelTarget", () => {
  it("resolves the first valid provider target", () => {
    const resolved = resolvePrimaryModelTarget({
      mode: "merge",
      providers: {
        litellm: {
          baseUrl: "http://localhost:4000",
          apiKey: "k-test",
          api: "openai-completions",
          models: [{ id: "zai/glm-4.7", name: "zai/glm-4.7" }]
        }
      }
    });

    expect(resolved).toEqual({
      providerName: "litellm",
      baseUrl: "http://localhost:4000",
      apiKey: "k-test",
      api: "openai-completions",
      modelId: "zai/glm-4.7"
    });
  });

  it("throws when model id is missing", () => {
    expect(() =>
      resolvePrimaryModelTarget({
        providers: {
          litellm: {
            baseUrl: "http://localhost:4000",
            apiKey: "k-test",
            api: "openai-completions",
            models: [{ name: "missing-id" }]
          }
        }
      })
    ).toThrow(AppError);
  });

  it("throws when providers are missing", () => {
    expect(() => resolvePrimaryModelTarget({})).toThrow(AppError);
  });
});
