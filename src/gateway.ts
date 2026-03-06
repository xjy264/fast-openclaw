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
    throw new AppError(ErrorCodes.GATEWAY_FAILED, `openclaw gateway ${action} 执行失败。`);
  }
}

export async function startGateway(logger: Logger): Promise<void> {
  logger.info("正在启动网关...");
  await runGatewayCommand("start");
}

export async function stopGateway(logger: Logger): Promise<void> {
  logger.info("正在停止网关...");
  await runGatewayCommand("stop");
}

export async function restartGateway(logger: Logger): Promise<void> {
  logger.info("正在重启网关...");
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
      "未找到网关 token。请设置 FAST_OPENCLAW_GATEWAY_TOKEN，或在 OpenClaw 配置中设置 gateway.auth.token。"
    );
  }

  logger.info(`正在测试网关连通性：${url} ...`);

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
        logger.success("网关连通性校验通过。");
        return url;
      }

      const body = await response.text();
      lastError = `${response.status} ${body || response.statusText}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
    }

    if (attempt < maxAttempts) {
      logger.warn(`网关尚未就绪（第 ${attempt}/${maxAttempts} 次）。正在重试...`);
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new AppError(
    ErrorCodes.GATEWAY_FAILED,
    `网关连通性测试失败（重试 ${maxAttempts} 次）：${lastError}`
  );
}

interface AgentPayload {
  text?: string;
}

interface AgentRunResult {
  payloads?: AgentPayload[];
  result?: {
    payloads?: AgentPayload[];
  };
}

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

function parseAgentRunResult(stdout: string): AgentRunResult | null {
  const cleaned = stripAnsi(stdout).trim();
  if (!cleaned) {
    return null;
  }

  try {
    return JSON.parse(cleaned) as AgentRunResult;
  } catch {
    // Some OpenClaw versions may prepend/append warning text around JSON.
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }

  const candidate = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as AgentRunResult;
  } catch {
    return null;
  }
}

export function summarizeAgentOutput(output: string, maxLines = 8): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => (line.length > 220 ? `${line.slice(0, 220)}...` : line));

  if (lines.length === 0) {
    return "无命令输出";
  }

  return lines.join(" | ");
}

export function hasAgentReply(stdout: string): boolean {
  const parsed = parseAgentRunResult(stdout);
  if (!parsed) {
    return false;
  }

  const payloads = [
    ...(Array.isArray(parsed.payloads) ? parsed.payloads : []),
    ...(Array.isArray(parsed.result?.payloads) ? parsed.result.payloads : [])
  ];

  if (payloads.length === 0) {
    return false;
  }

  return payloads.some((item) => typeof item?.text === "string" && item.text.trim().length > 0);
}

export function hasGatewayFallbackSignal(output: string): boolean {
  const normalized = output.toLowerCase();
  return (
    normalized.includes("falling back to embedded") ||
    normalized.includes("gateway agent failed")
  );
}

export async function verifyAgentConversation(logger: Logger): Promise<void> {
  logger.info("正在用 `openclaw agent` 校验对话链路...");
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

  const fallbackDetected = hasGatewayFallbackSignal(result.stderr);
  if (result.code !== 0 || fallbackDetected || !hasAgentReply(result.stdout)) {
    const stdoutSummary = summarizeAgentOutput(result.stdout, 6);
    const stderrSummary = summarizeAgentOutput(result.stderr, 6);
    throw new AppError(
      ErrorCodes.AGENT_CHECK_FAILED,
      `OpenClaw gateway 对话校验失败。禁止回退到 embedded。stdout：${stdoutSummary}。stderr：${stderrSummary}`
    );
  }

  logger.success("OpenClaw 网关对话校验通过。");
}
