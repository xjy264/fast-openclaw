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
      summary: "模型连通性检查失败。",
      hints: [
        "确认 `~/.openclaw/openclaw.json` 中 `models.providers.*.baseUrl/apiKey/api/models[0].id` 配置完整且正确。",
        "确认模型提供商 key 还有额度并且具备目标模型权限。",
        "仅重试模型检查：`fast-openclaw --test-only model --debug`。"
      ]
    };
  }

  if (code === ErrorCodes.GATEWAY_FAILED) {
    return {
      summary: "Gateway 检查失败。",
      hints: [
        "先执行 `openclaw gateway start`，等待 3-5 秒后再重试。",
        "设置 `OPENCLAW_GATEWAY_TOKEN` 或 `FAST_OPENCLAW_GATEWAY_TOKEN`，或在 openclaw.json 中配置 `gateway.auth.token`。",
        "仅重试 gateway 检查：`fast-openclaw --test-only gateway --debug`。"
      ]
    };
  }

  if (code === ErrorCodes.AGENT_CHECK_FAILED) {
    return {
      summary: "Agent 对话检查失败。",
      hints: [
        "当前版本默认不执行 `openclaw agent` 对话检查。",
        "请改用网关连通性检查：`fast-openclaw --test-only gateway --debug`。",
        "若你手动执行了 agent 命令失败，请重点检查模型 key、网关 token 与网络。"
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_API_INVALID) {
    return {
      summary: "Telegram Bot Token 无效，或 Telegram API 调用失败。",
      hints: [
        "确认 token 格式正确且 bot 仍然存在。",
        "检查到 `https://api.telegram.org` 的网络连通性。",
        "显式带 token + chat id 重试 Telegram 检查：`fast-openclaw --test-only telegram --telegram-bot-token <token> --telegram-chat-id <id> --debug`。"
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_DISCOVERY_TIMEOUT) {
    return {
      summary: "Telegram 弱校验轮询超时。",
      hints: [
        "当前主流程已不使用 chat id 自动发现；请直接传入 `--telegram-chat-id`。",
        "若你在 doctor 弱校验中遇到该错误，请确认在同一会话发出了 `你是谁` 与 `/model`。",
        "重试命令：`fast-openclaw --doctor --telegram-bot-token <token> --telegram-chat-id <id>`。"
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_BIND_FAILED) {
    return {
      summary: "Telegram sendMessage 测试失败。",
      hints: [
        "确认 chat id 手动填写正确，且 bot 有权限向该会话发消息。",
        "若是私聊，请先确保用户已经给 bot 发过 /start。",
        "若是群聊，请确认 bot 已加入且未被群权限限制。"
      ]
    };
  }

  if (code === ErrorCodes.CHANNEL_PLUGIN_INSTALL_FAILED) {
    return {
      summary: "渠道插件安装失败。",
      hints: [
        "请先手动执行：`openclaw plugins install openclaw-dingtalk`。",
        "确认网络可访问 npm，且本机 `openclaw` 命令可正常执行。",
        "修复后重试：`fast-openclaw --test-only dingtalk --debug`。"
      ]
    };
  }

  if (code === ErrorCodes.CHANNEL_BIND_FAILED) {
    return {
      summary: "渠道配置校验失败。",
      hints: [
        "若选择 Telegram，请确认 `bot token` 与 `chat id` 都已填写。",
        "若选择钉钉，请确认 5 个参数（clientId/clientSecret/robotCode/corpId/agentId）均非空。",
        "可单独重试：`fast-openclaw --test-only telegram ...` 或 `fast-openclaw --test-only dingtalk ...`。"
      ]
    };
  }

  if (code === ErrorCodes.TELEGRAM_WEAK_VALIDATION_FAILED) {
    return {
      summary: "Telegram 弱校验超时。",
      hints: [
        "请在同一个会话里发送两条消息：`你是谁` 和 `/model`。",
        "确认 bot token 与所选 chat id 对应的是同一个会话。",
        "可在 doctor 模式中单独重试弱校验。"
      ]
    };
  }

  if (code === ErrorCodes.VERSION_NOT_FOUND || code === ErrorCodes.PATH_FIX_FAILED) {
    return {
      summary: "当前 shell PATH 中找不到 OpenClaw 命令。",
      hints: [
        "执行 `echo 'export PATH=\"$HOME/.local/bin:$PATH\"' >> ~/.zshrc && source ~/.zshrc`。",
        "若通过 npm 安装，也请把 npm 全局 bin 目录加入 PATH。",
        "执行 `openclaw --version` 确认可用后再重试。"
      ]
    };
  }

  if (code === ErrorCodes.INSTALL_FAILED || code === ErrorCodes.ONBOARD_FAILED) {
    return {
      summary: "OpenClaw 安装失败。",
      hints: [
        "重试安装脚本：`curl -fsSL https://openclaw.ai/install.sh | bash`。",
        "确认 `openclaw --version` 可用，并检查 PATH 配置是否生效。",
        "修复后重新运行 setup 或 doctor 检查。"
      ]
    };
  }

  return {
    summary: "发生未预期的诊断失败。",
    hints: [
      "请加 `--debug` 重新运行并记录错误输出。",
      "检查 `~/.openclaw/openclaw.json` 是否有 JSON 格式错误或缺少必填字段。",
      "运行分段检查（`--test-only model|gateway|telegram|dingtalk`）定位具体故障点。"
    ]
  };
}
