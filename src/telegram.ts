import { password, select } from "@inquirer/prompts";
import { mergeAndWriteConfig } from "./config.js";
import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";

interface TelegramApiError {
  ok: false;
  error_code?: number;
  description?: string;
}

interface TelegramApiOk<T> {
  ok: true;
  result: T;
}

type TelegramApiResponse<T> = TelegramApiOk<T> | TelegramApiError;

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramMessage {
  chat?: TelegramChat;
  text?: string;
  date?: number;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
}

export interface TelegramChatCandidate {
  chatId: string;
  type: string;
  title: string;
  username: string;
  displayName: string;
  lastUpdateId: number;
  lastMessage: string;
  lastDate: number;
}

export interface TelegramWeakSignals {
  askedWhoAmI: boolean;
  requestedModel: boolean;
}

function apiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function callTelegram<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>
): Promise<TelegramApiResponse<T>> {
  const response = await fetch(apiUrl(token, method), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  try {
    return (await response.json()) as TelegramApiResponse<T>;
  } catch {
    return {
      ok: false,
      error_code: response.status,
      description: "Telegram API returned non-JSON response"
    };
  }
}

function getUpdateMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "");
}

export function extractChatCandidatesFromUpdates(updates: TelegramUpdate[]): TelegramChatCandidate[] {
  const map = new Map<string, TelegramChatCandidate>();

  for (const update of updates) {
    const msg = getUpdateMessage(update);
    const chat = msg?.chat;
    if (!chat) {
      continue;
    }

    const chatId = String(chat.id);
    const displayName =
      chat.title || [chat.first_name ?? "", chat.last_name ?? ""].join(" ").trim() || chat.username || chatId;

    const candidate: TelegramChatCandidate = {
      chatId,
      type: chat.type || "unknown",
      title: chat.title ?? "",
      username: chat.username ?? "",
      displayName,
      lastUpdateId: update.update_id,
      lastMessage: (msg?.text ?? "").slice(0, 120),
      lastDate: Number(msg?.date ?? 0)
    };

    const existing = map.get(chatId);
    if (!existing || candidate.lastUpdateId > existing.lastUpdateId) {
      map.set(chatId, candidate);
    }
  }

  return [...map.values()].sort((a, b) => b.lastUpdateId - a.lastUpdateId);
}

export function extractWeakSignalsFromUpdates(
  updates: TelegramUpdate[],
  chatId: string
): TelegramWeakSignals {
  const targetChatId = chatId.trim();
  let askedWhoAmI = false;
  let requestedModel = false;

  for (const update of updates) {
    const msg = getUpdateMessage(update);
    const chat = msg?.chat;
    if (!chat || String(chat.id) !== targetChatId) {
      continue;
    }

    const text = typeof msg?.text === "string" ? msg.text : "";
    if (!text.trim()) {
      continue;
    }

    const normalized = normalizeText(text);
    if (normalized.includes("你是谁")) {
      askedWhoAmI = true;
    }

    if (normalized.startsWith("/model")) {
      requestedModel = true;
    }
  }

  return { askedWhoAmI, requestedModel };
}

export async function validateBotToken(token: string, logger: Logger): Promise<TelegramUser> {
  logger.info("Validating Telegram bot token...");
  const result = await callTelegram<TelegramUser>(token, "getMe");
  if (!result.ok) {
    throw new AppError(
      ErrorCodes.TELEGRAM_API_INVALID,
      `Telegram token invalid: ${result.description ?? "unknown error"}`
    );
  }
  logger.success(`Telegram bot validated: @${result.result.username ?? result.result.id}`);
  return result.result;
}

export async function discoverChatCandidates(
  token: string,
  logger: Logger,
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<TelegramChatCandidate[]> {
  const timeoutMs = options?.timeoutMs ?? 90000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2500;

  logger.info("Please send /start to your Telegram bot now (or send a message in target chat). Waiting for updates...");

  const deadline = Date.now() + timeoutMs;
  const seen = new Map<string, TelegramChatCandidate>();
  let offset: number | undefined;

  while (Date.now() < deadline) {
    const updatesResp = await callTelegram<TelegramUpdate[]>(token, "getUpdates", {
      offset,
      limit: 100,
      timeout: 20
    });

    if (!updatesResp.ok) {
      throw new AppError(
        ErrorCodes.TELEGRAM_API_INVALID,
        `Telegram getUpdates failed: ${updatesResp.description ?? "unknown"}`
      );
    }

    const updates = updatesResp.result ?? [];
    if (updates.length > 0) {
      const maxUpdate = Math.max(...updates.map((item) => item.update_id));
      offset = maxUpdate + 1;
      for (const candidate of extractChatCandidatesFromUpdates(updates)) {
        const prev = seen.get(candidate.chatId);
        if (!prev || candidate.lastUpdateId > prev.lastUpdateId) {
          seen.set(candidate.chatId, candidate);
        }
      }

      if (seen.size > 0) {
        return [...seen.values()].sort((a, b) => b.lastUpdateId - a.lastUpdateId);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new AppError(
    ErrorCodes.TELEGRAM_DISCOVERY_TIMEOUT,
    "No Telegram chat discovered in time. Send /start to bot and retry resume."
  );
}

export async function selectChatId(candidates: TelegramChatCandidate[]): Promise<string> {
  if (candidates.length === 0) {
    throw new AppError(ErrorCodes.TELEGRAM_DISCOVERY_TIMEOUT, "No Telegram chat candidates found.");
  }

  if (candidates.length === 1) {
    return candidates[0].chatId;
  }

  return select<string>({
    message: "Select Telegram chat to bind",
    choices: candidates.map((item) => ({
      name: `${item.displayName} [${item.type}] (${item.chatId})${item.lastMessage ? ` - ${item.lastMessage}` : ""}`,
      value: item.chatId
    }))
  });
}

export async function getBotTokenFromInput(prefilled?: string): Promise<string> {
  if (prefilled?.trim()) {
    return prefilled.trim();
  }

  const token = await password({
    message: "Telegram bot token",
    mask: "*",
    validate: (value) => (value.trim() ? true : "Telegram bot token is required")
  });
  return token.trim();
}

export async function configureOpenClawTelegram(
  token: string,
  logger: Logger
): Promise<void> {
  logger.info("Configuring OpenClaw telegram channel...");
  const result = await runCommand("openclaw", ["channels", "add", "--channel", "telegram", "--token", token]);
  if (result.code === 0) {
    logger.success("Telegram channel configured via `openclaw channels add`.");
    return;
  }

  logger.warn("`openclaw channels add` failed, falling back to openclaw.json patch.");
  await mergeAndWriteConfig({
    channels: {
      telegram: {
        enabled: true,
        botToken: token
      }
    }
  });
  logger.success("Telegram channel configured via openclaw.json patch fallback.");
}

export async function sendTelegramTestMessage(
  token: string,
  chatId: string,
  logger: Logger
): Promise<void> {
  logger.info(`Sending Telegram test message to chat ${chatId} ...`);
  const resp = await callTelegram<{ message_id: number }>(token, "sendMessage", {
    chat_id: chatId,
    text: "✅ fast-openclaw telegram test"
  });

  if (!resp.ok) {
    throw new AppError(
      ErrorCodes.TELEGRAM_BIND_FAILED,
      `Telegram test send failed: ${resp.description ?? "unknown error"}`
    );
  }

  logger.success("Telegram test message sent successfully.");
}

export async function verifyTelegramWeakSignals(
  token: string,
  chatId: string,
  logger: Logger,
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 180000;
  const pollIntervalMs = options?.pollIntervalMs ?? 2500;

  logger.info("Weak validation: send `你是谁` and `/model` to the bot in Telegram now.");

  let offset: number | undefined;
  const baseline = await callTelegram<TelegramUpdate[]>(token, "getUpdates", {
    limit: 100,
    timeout: 1
  });
  if (!baseline.ok) {
    throw new AppError(
      ErrorCodes.TELEGRAM_API_INVALID,
      `Telegram getUpdates failed: ${baseline.description ?? "unknown"}`
    );
  }

  if (baseline.result.length > 0) {
    offset = Math.max(...baseline.result.map((item) => item.update_id)) + 1;
  }

  const deadline = Date.now() + timeoutMs;
  let seenWhoAmI = false;
  let seenModel = false;

  while (Date.now() < deadline) {
    const updatesResp = await callTelegram<TelegramUpdate[]>(token, "getUpdates", {
      offset,
      limit: 100,
      timeout: 20
    });

    if (!updatesResp.ok) {
      throw new AppError(
        ErrorCodes.TELEGRAM_API_INVALID,
        `Telegram getUpdates failed: ${updatesResp.description ?? "unknown"}`
      );
    }

    const updates = updatesResp.result ?? [];
    if (updates.length > 0) {
      const maxUpdate = Math.max(...updates.map((item) => item.update_id));
      offset = maxUpdate + 1;

      const signals = extractWeakSignalsFromUpdates(updates, chatId);
      seenWhoAmI = seenWhoAmI || signals.askedWhoAmI;
      seenModel = seenModel || signals.requestedModel;

      if (seenWhoAmI && seenModel) {
        logger.success("Telegram weak validation passed (received `你是谁` and `/model`).");
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const missing: string[] = [];
  if (!seenWhoAmI) {
    missing.push("你是谁");
  }
  if (!seenModel) {
    missing.push("/model");
  }

  throw new AppError(
    ErrorCodes.TELEGRAM_WEAK_VALIDATION_FAILED,
    `Telegram weak validation timeout. Missing inbound message(s): ${missing.join(", ")}`
  );
}
