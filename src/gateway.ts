import { input, password } from "@inquirer/prompts";
import { DEFAULT_GATEWAY_URL } from "./constants.js";
import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";

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
    gatewayUrl && gatewayUrl.trim()
      ? gatewayUrl.trim()
      : await input({ message: "Gateway URL", default: DEFAULT_GATEWAY_URL });

  let token = tokenFromServer?.trim() ?? "";
  if (!token) {
    token = await password({
      message: "Gateway token for Authorization: Bearer <token>",
      mask: "*",
      validate: (value) => (value.trim() ? true : "Gateway token is required")
    });
  }

  logger.info(`Testing gateway connectivity at ${url} ...`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new AppError(
      ErrorCodes.GATEWAY_FAILED,
      `Gateway connectivity test failed: ${response.status} ${body || response.statusText}`
    );
  }

  logger.success("Gateway connectivity verified.");
  return url;
}

interface AgentPayload {
  text?: string;
}

interface AgentRunResult {
  payloads?: AgentPayload[];
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
    throw new AppError(
      ErrorCodes.AGENT_CHECK_FAILED,
      "OpenClaw gateway conversation check failed. Fallback-to-embedded is not allowed."
    );
  }

  logger.success("OpenClaw gateway conversation check passed.");
}
