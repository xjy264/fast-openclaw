import { DEFAULT_GATEWAY_URL } from "./constants.js";
import { readOpenClawConfig } from "./config.js";
import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTokenFromConfig(config: Record<string, unknown>): string {
  const gateway = config.gateway;
  if (typeof gateway !== "object" || gateway === null || Array.isArray(gateway)) {
    return "";
  }

  const token = asString((gateway as Record<string, unknown>).token);
  if (token) {
    return token;
  }

  const auth = (gateway as Record<string, unknown>).auth;
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    return "";
  }

  return asString((auth as Record<string, unknown>).token);
}

async function runGatewayCommand(action: "start" | "stop" | "restart"): Promise<void> {
  const result = await runCommand("openclaw", ["gateway", action], {
    inheritStdio: true
  });

  if (result.code !== 0) {
    throw new AppError(ErrorCodes.GATEWAY_FAILED, `openclaw gateway ${action} failed.`);
  }
}

export async function startGateway(logger: Logger): Promise<void> {
  logger.info("Starting gateway...");
  await runGatewayCommand("start");
}

export async function stopGateway(logger: Logger): Promise<void> {
  logger.info("Stopping gateway...");
  await runGatewayCommand("stop");
}

export async function restartGateway(logger: Logger): Promise<void> {
  logger.info("Restarting gateway...");
  await runGatewayCommand("restart");
}

export async function verifyGatewayConnectivity(
  logger: Logger,
  gatewayUrl?: string,
  tokenFromServer?: string
): Promise<string> {
  const url =
    gatewayUrl?.trim() ||
    process.env.FAST_OPENCLAW_GATEWAY_URL?.trim() ||
    DEFAULT_GATEWAY_URL;

  let token =
    tokenFromServer?.trim() ||
    process.env.OPENCLAW_GATEWAY_TOKEN?.trim() ||
    process.env.FAST_OPENCLAW_GATEWAY_TOKEN?.trim() ||
    "";

  if (!token) {
    const config = await readOpenClawConfig();
    token = readTokenFromConfig(config as Record<string, unknown>);
  }

  if (!token) {
    throw new AppError(
      ErrorCodes.GATEWAY_FAILED,
      "Gateway token not found. Set FAST_OPENCLAW_GATEWAY_TOKEN or configure OpenClaw gateway auth token."
    );
  }

  logger.info(`Testing gateway connectivity at ${url} ...`);

  const maxAttempts = 8;
  const retryDelayMs = 1500;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (response.ok) {
        logger.success("Gateway connectivity verified.");
        return url;
      }

      const body = await response.text();
      lastError = `${response.status} ${body || response.statusText}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
    }

    if (attempt < maxAttempts) {
      logger.warn(`Gateway not ready yet (attempt ${attempt}/${maxAttempts}). Retrying...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new AppError(
    ErrorCodes.GATEWAY_FAILED,
    `Gateway connectivity test failed after ${maxAttempts} attempts: ${lastError}`
  );
}

interface AgentPayload {
  text?: string;
}

interface AgentRunResult {
  payloads?: AgentPayload[];
}

export function summarizeAgentOutput(output: string, maxLines = 8): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => (line.length > 220 ? `${line.slice(0, 220)}...` : line));

  if (lines.length === 0) {
    return "no command output";
  }

  return lines.join(" | ");
}

export function hasAgentReply(stdout: string): boolean {
  try {
    const parsed = JSON.parse(stdout) as AgentRunResult;
    if (!Array.isArray(parsed.payloads) || parsed.payloads.length === 0) {
      return false;
    }
    return parsed.payloads.some((item) => typeof item?.text === "string" && item.text.trim().length > 0);
  } catch {
    return false;
  }
}

export function hasGatewayFallbackSignal(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("falling back to embedded") ||
    normalized.includes("gateway agent failed")
  );
}

export async function verifyAgentConversation(logger: Logger): Promise<void> {
  logger.info("Checking OpenClaw conversation with `openclaw agent`...");
  const result = await runCommand("openclaw", [
    "agent",
    "--agent",
    "main",
    "--json",
    "-m",
    "health-check: reply with one short sentence",
    "--timeout",
    "90"
  ]);

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0 || hasGatewayFallbackSignal(combinedOutput) || !hasAgentReply(result.stdout)) {
    const summary = summarizeAgentOutput(combinedOutput);
    throw new AppError(
      ErrorCodes.AGENT_CHECK_FAILED,
      `OpenClaw gateway conversation check failed. Fallback-to-embedded is not allowed. Output summary: ${summary}`
    );
  }

  logger.success("OpenClaw gateway conversation check passed.");
}
