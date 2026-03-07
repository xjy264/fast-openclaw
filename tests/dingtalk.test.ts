import { describe, expect, it } from "vitest";
import { AppError, ErrorCodes } from "../src/errors.js";
import { isPluginAlreadyExistsOutput, validateDingtalkConfigInput } from "../src/dingtalk.js";

describe("validateDingtalkConfigInput", () => {
  it("accepts and trims all required fields", () => {
    const input = validateDingtalkConfigInput({
      clientId: "  ding-client  ",
      clientSecret: "  ding-secret  ",
      robotCode: "  ding-robot  ",
      corpId: "  ding-corp  ",
      agentId: "  123456  "
    });

    expect(input).toEqual({
      clientId: "ding-client",
      clientSecret: "ding-secret",
      robotCode: "ding-robot",
      corpId: "ding-corp",
      agentId: "123456"
    });
  });

  it("throws CHANNEL_BIND_FAILED when any field is missing", () => {
    try {
      validateDingtalkConfigInput({
        clientId: "",
        clientSecret: "secret",
        robotCode: "robot",
        corpId: "corp",
        agentId: "agent"
      });
      throw new Error("expected validateDingtalkConfigInput to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCodes.CHANNEL_BIND_FAILED);
    }
  });
});

describe("isPluginAlreadyExistsOutput", () => {
  it("detects plugin already exists text", () => {
    expect(isPluginAlreadyExistsOutput("plugin already exists: openclaw-dingtalk")).toBe(true);
    expect(isPluginAlreadyExistsOutput("already exists openclaw-dingtalk")).toBe(true);
  });

  it("returns false for unrelated output", () => {
    expect(isPluginAlreadyExistsOutput("network timeout")).toBe(false);
  });
});
