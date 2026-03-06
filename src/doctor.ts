import { AppError, ErrorCodes } from "./errors.js";

export interface DoctorHintBundle {
  summary: string;
  hints: string[];
}

function getErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  return ErrorCodes.UNKNOWN;
}

export function buildDoctorHints(error: unknown): DoctorHintBundle {
  const code = getErrorCode(error);

  if (code === ErrorCodes.MODEL_TEST_FAILED) {
    return {
      summary: "Model connectivity check failed.",
      hints: [
        "Confirm `~/.openclaw/openclaw.json` contains valid `models.providers.*.baseUrl/apiKey/api/models[0].id`.",
        "Verify the provider key has quota and model access permissions.",
        "Retry model-only check: `fast-openclaw --test-only model --debug`."
      ]
    };
  }

  if (code === ErrorCodes.GATEWAY_FAILED) {
    return {
      summary: "Gateway check failed.",
      hints: [
        "Run `openclaw gateway start` and wait 3-5 seconds before retry.",
        "Set token in `OPENCLAW_GATEWAY_TOKEN` or `FAST_OPENCLAW_GATEWAY_TOKEN`, or configure `gateway.auth.token` in openclaw.json.",
        "Retry gateway-only check: `fast-openclaw --test-only gateway --debug`."
      ]
    };
  }

  if (code === ErrorCodes.AGENT_CHECK_FAILED) {
    return {
      summary: "Agent conversation check failed.",
      hints: [
        "Ensure gateway verification passes first; agent check requires gateway path.",
        "Confirm model config is valid and reachable, then retry full check.",
        "Inspect `openclaw agent --agent main --json ...` output for fallback markers."
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_API_INVALID) {
    return {
      summary: "Telegram bot token is invalid or Telegram API call failed.",
      hints: [
        "Confirm bot token format is correct and bot still exists.",
        "Check network to `https://api.telegram.org`.",
        "Retry Telegram check with explicit token: `fast-openclaw --test-only telegram --telegram-bot-token <token> --debug`."
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_DISCOVERY_TIMEOUT) {
    return {
      summary: "Telegram chat discovery timed out.",
      hints: [
        "Send `/start` to the bot in private chat, or send any message in target group mentioning the bot.",
        "Then rerun Telegram check and pick the discovered chat.",
        "You can bypass discovery with `--telegram-chat-id <id>` for debugging."
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_BIND_FAILED) {
    return {
      summary: "Telegram sendMessage test failed.",
      hints: [
        "Confirm chat id is correct and bot can send messages to this chat.",
        "If private chat: ensure user has started the bot first.",
        "If group chat: ensure bot has been added and not muted by restrictions."
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_WEAK_VALIDATION_FAILED) {
    return {
      summary: "Telegram weak validation timed out.",
      hints: [
        "Send both messages to the same chat: `你是谁` and `/model`.",
        "Make sure bot token and selected chat id belong to that same chat.",
        "Retry weak validation from doctor mode."
      ]
    };
  }

  if (code === ErrorCodes.VERSION_NOT_FOUND || code === ErrorCodes.PATH_FIX_FAILED) {
    return {
      summary: "OpenClaw CLI command is not available in shell PATH.",
      hints: [
        "Run `echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.zshrc && source ~/.zshrc`.",
        "If installed via npm, append npm global bin to PATH as well.",
        "Run `openclaw --version` to confirm before retry."
      ]
    };
  }

  if (code === ErrorCodes.INSTALL_FAILED || code === ErrorCodes.ONBOARD_FAILED) {
    return {
      summary: "OpenClaw install/onboard failed.",
      hints: [
        "Retry install script: `curl -fsSL https://openclaw.ai/install.sh | bash`.",
        "Run `openclaw onboard --install-daemon --non-interactive ...` manually once to inspect errors.",
        "Then rerun setup or doctor checks."
      ]
    };
  }

  return {
    summary: "Unexpected diagnostic failure.",
    hints: [
      "Rerun with `--debug` and capture error output.",
      "Check `~/.openclaw/openclaw.json` for malformed JSON or missing required fields.",
      "Run isolated checks (`--test-only model|gateway|telegram`) to narrow down root cause."
    ]
  };
}
