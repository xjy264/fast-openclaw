import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OPENCLAW_INSTALL_CMD, PATH_EXPORT_LINES } from "./constants.js";
import { AppError, ErrorCodes } from "./errors.js";
import { runCommand } from "./exec.js";
import { Logger } from "./logger.js";

function getShellRcFiles(): string[] {
  const home = os.homedir();
  return [path.join(home, ".zshrc"), path.join(home, ".bashrc")];
}

async function ensureRcLines(rcPath: string, lines: string[]): Promise<void> {
  let existing = "";
  try {
    existing = await fs.readFile(rcPath, "utf8");
  } catch {
    // File may not exist.
  }

  const toAppend = lines.filter((line) => !existing.includes(line));
  if (toAppend.length === 0) {
    return;
  }

  const content = `${existing.trimEnd()}\n${toAppend.join("\n")}\n`;
  await fs.writeFile(rcPath, content, "utf8");
}

async function getNpmGlobalBin(): Promise<string> {
  const result = await runCommand("npm", ["prefix", "-g"]);
  if (result.code !== 0 || !result.stdout) {
    throw new AppError(ErrorCodes.PATH_FIX_FAILED, "无法检测 npm 全局安装前缀。");
  }
  return path.join(result.stdout.trim(), "bin");
}

function updateProcessPath(extraPaths: string[]): void {
  const current = process.env.PATH ?? "";
  const parts = current.split(":");
  const merged = [...extraPaths, ...parts.filter(Boolean)].filter(
    (item, index, array) => array.indexOf(item) === index
  );
  process.env.PATH = merged.join(":");
}

export async function installOpenClaw(logger: Logger): Promise<void> {
  logger.info("正在安装 OpenClaw...");
  const result = await runCommand("bash", ["-lc", OPENCLAW_INSTALL_CMD], {
    inheritStdio: true
  });
  if (result.code !== 0) {
    throw new AppError(ErrorCodes.INSTALL_FAILED, "OpenClaw 安装命令执行失败。");
  }
}

export async function readOpenClawVersion(): Promise<string | null> {
  const result = await runCommand("openclaw", ["--version"]);
  if (result.code === 0 && result.stdout) {
    return result.stdout.trim();
  }
  if (result.stderr.includes("command not found") || result.stderr.includes("not found")) {
    return null;
  }
  return null;
}

export async function fixPathAndRetryVersion(logger: Logger): Promise<string> {
  logger.warn("未找到 openclaw 命令，正在为 zsh/bash 自动修复 PATH...");

  const npmBin = await getNpmGlobalBin();
  const localBin = path.join(os.homedir(), ".local", "bin");

  for (const rcFile of getShellRcFiles()) {
    const lines = [
      `export PATH=\"${npmBin}:$PATH\"`,
      PATH_EXPORT_LINES[1]
    ];
    await ensureRcLines(rcFile, lines);
  }

  updateProcessPath([npmBin, localBin]);

  const version = await readOpenClawVersion();
  if (!version) {
    throw new AppError(
      ErrorCodes.VERSION_NOT_FOUND,
      "PATH 修复后仍无法使用 OpenClaw。请重开终端或执行 `source ~/.zshrc` 后重试。"
    );
  }

  return version;
}

export async function resetOpenClawState(logger: Logger): Promise<void> {
  logger.warn("正在重置现有 OpenClaw 配置/状态，确保干净重装...");
  const result = await runCommand(
    "openclaw",
    ["reset", "--scope", "full", "--non-interactive", "--yes"],
    { inheritStdio: true }
  );

  if (result.code !== 0) {
    throw new AppError(ErrorCodes.INSTALL_FAILED, "重置 OpenClaw 状态失败。");
  }
}
