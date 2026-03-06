import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { input, password } from "@inquirer/prompts";
import { mergeAndWriteConfig, readOpenClawConfig } from "./config.js";
import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";
import type { CliOptions } from "./types.js";

const DINGTALK_PLUGIN_ID = "openclaw-dingtalk";
const DINGTALK_PLUGIN_DIR = path.join(os.homedir(), ".openclaw", "extensions", DINGTALK_PLUGIN_ID);

export interface DingtalkConfigInput {
  clientId: string;
  clientSecret: string;
  robotCode: string;
  corpId: string;
  agentId: string;
}

function trim(value: string | undefined): string {
  return (value ?? "").trim();
}

function assertRequired(value: string, fieldLabel: string): string {
  if (!value.trim()) {
    throw new AppError(ErrorCodes.CHANNEL_BIND_FAILED, `钉钉参数缺失：${fieldLabel}`);
  }
  return value.trim();
}

async function askText(message: string, prefilled?: string): Promise<string> {
  if (prefilled?.trim()) {
    return prefilled.trim();
  }

  const value = await input({
    message,
    validate: (raw) => (raw.trim() ? true : `${message} 不能为空`)
  });
  return value.trim();
}

async function askSecret(message: string, prefilled?: string): Promise<string> {
  if (prefilled?.trim()) {
    return prefilled.trim();
  }

  const value = await password({
    message,
    mask: "*",
    validate: (raw) => (raw.trim() ? true : `${message} 不能为空`)
  });
  return value.trim();
}

export async function collectDingtalkConfigInput(
  options: Pick<
    CliOptions,
    "dingtalkClientId" | "dingtalkClientSecret" | "dingtalkRobotCode" | "dingtalkCorpId" | "dingtalkAgentId"
  >
): Promise<DingtalkConfigInput> {
  const inputValues: DingtalkConfigInput = {
    clientId: await askText("请输入钉钉 clientId", options.dingtalkClientId),
    clientSecret: await askSecret("请输入钉钉 clientSecret", options.dingtalkClientSecret),
    robotCode: await askText("请输入钉钉 robotCode", options.dingtalkRobotCode),
    corpId: await askText("请输入钉钉 corpId", options.dingtalkCorpId),
    agentId: await askText("请输入钉钉 agentId", options.dingtalkAgentId)
  };

  return validateDingtalkConfigInput(inputValues);
}

export function validateDingtalkConfigInput(inputValues: DingtalkConfigInput): DingtalkConfigInput {
  return {
    clientId: assertRequired(trim(inputValues.clientId), "clientId"),
    clientSecret: assertRequired(trim(inputValues.clientSecret), "clientSecret"),
    robotCode: assertRequired(trim(inputValues.robotCode), "robotCode"),
    corpId: assertRequired(trim(inputValues.corpId), "corpId"),
    agentId: assertRequired(trim(inputValues.agentId), "agentId")
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDingtalkPluginInstalled(logger: Logger): Promise<void> {
  if (await pathExists(DINGTALK_PLUGIN_DIR)) {
    logger.info(`检测到钉钉插件已安装：${DINGTALK_PLUGIN_ID}`);
    return;
  }

  logger.info(`未检测到钉钉插件，正在安装：${DINGTALK_PLUGIN_ID}`);
  const result = await runCommand("openclaw", ["plugins", "install", DINGTALK_PLUGIN_ID]);

  if (result.code !== 0 && !(await pathExists(DINGTALK_PLUGIN_DIR))) {
    const details = [result.stderr, result.stdout].filter(Boolean).join(" | ").slice(0, 240);
    throw new AppError(
      ErrorCodes.CHANNEL_PLUGIN_INSTALL_FAILED,
      `安装钉钉插件失败：${details || "未知错误"}`
    );
  }

  logger.success("钉钉插件安装完成。");
}

export async function configureOpenClawDingtalk(
  inputValues: DingtalkConfigInput,
  logger: Logger
): Promise<void> {
  const validated = validateDingtalkConfigInput(inputValues);
  await ensureDingtalkPluginInstalled(logger);

  await mergeAndWriteConfig({
    plugins: {
      enabled: true,
      allow: [DINGTALK_PLUGIN_ID],
      entries: {
        [DINGTALK_PLUGIN_ID]: {
          enabled: true
        }
      }
    },
    channels: {
      dingtalk: {
        enabled: true,
        clientId: validated.clientId,
        clientSecret: validated.clientSecret,
        robotCode: validated.robotCode,
        corpId: validated.corpId,
        agentId: validated.agentId,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: ["*"],
        groupAllowFrom: ["*"],
        messageType: "markdown",
        debug: false
      }
    }
  });

  logger.success("钉钉渠道配置已写入 openclaw.json。");
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function verifyDingtalkConfigured(logger: Logger): Promise<void> {
  if (!(await pathExists(DINGTALK_PLUGIN_DIR))) {
    throw new AppError(
      ErrorCodes.CHANNEL_BIND_FAILED,
      `未检测到钉钉插件目录：${DINGTALK_PLUGIN_DIR}`
    );
  }

  const config = await readOpenClawConfig();
  const dingtalk = asRecord(asRecord(config.channels).dingtalk);

  const validated = validateDingtalkConfigInput({
    clientId: String(dingtalk.clientId ?? ""),
    clientSecret: String(dingtalk.clientSecret ?? ""),
    robotCode: String(dingtalk.robotCode ?? ""),
    corpId: String(dingtalk.corpId ?? ""),
    agentId: String(dingtalk.agentId ?? "")
  });

  const pluginConfig = asRecord(asRecord(config.plugins).entries);
  const pluginEntry = asRecord(pluginConfig[DINGTALK_PLUGIN_ID]);
  if (pluginEntry.enabled !== true) {
    throw new AppError(
      ErrorCodes.CHANNEL_BIND_FAILED,
      "钉钉插件已安装，但 openclaw.json 中 plugins.entries.openclaw-dingtalk.enabled 不是 true。"
    );
  }

  const pluginAllow = asRecord(config.plugins).allow;
  if (!Array.isArray(pluginAllow) || !pluginAllow.includes(DINGTALK_PLUGIN_ID)) {
    throw new AppError(
      ErrorCodes.CHANNEL_BIND_FAILED,
      "openclaw.json 中 plugins.allow 未包含 openclaw-dingtalk。"
    );
  }

  logger.success(
    `钉钉配置校验通过（clientId=${validated.clientId}，robotCode=${validated.robotCode}，agentId=${validated.agentId}）。`
  );
}
