import { describe, expect, it } from "vitest";
import { hasAgentReply, hasGatewayFallbackSignal, summarizeAgentOutput } from "../src/gateway.js";

describe("hasAgentReply", () => {
  it("returns true when payload contains text", () => {
    const stdout = JSON.stringify({
      payloads: [{ text: "ok" }]
    });

    expect(hasAgentReply(stdout)).toBe(true);
  });

  it("returns false when payloads is empty", () => {
    const stdout = JSON.stringify({ payloads: [] });
    expect(hasAgentReply(stdout)).toBe(false);
  });

  it("returns false for invalid json", () => {
    expect(hasAgentReply("not-json")).toBe(false);
  });
});

describe("hasGatewayFallbackSignal", () => {
  it("returns true when output contains fallback marker", () => {
    expect(hasGatewayFallbackSignal("Gateway agent failed; falling back to embedded")).toBe(true);
  });

  it("returns false for normal output", () => {
    expect(hasGatewayFallbackSignal("{\"payloads\":[{\"text\":\"ok\"}]}")).toBe(false);
  });
});

describe("summarizeAgentOutput", () => {
  it("returns first non-empty lines joined as summary", () => {
    const output = "\nline-a\nline-b\nline-c\n";
    expect(summarizeAgentOutput(output, 2)).toBe("line-a | line-b");
  });

  it("returns fallback text for empty output", () => {
    expect(summarizeAgentOutput("   \n \n")).toBe("no command output");
  });
});
