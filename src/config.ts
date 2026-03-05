import fs from "node:fs/promises";
import path from "node:path";
import { OPENCLAW_CONFIG_PATH } from "./constants.js";
import { AppError, ErrorCodes } from "./errors.js";
import { validateModelsConfig } from "./model.js";
import type { OpenClawConfig } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) {
    return patch;
  }

  if (!isObject(base) || !isObject(patch)) {
    return patch;
  }

  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key in result) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function readOpenClawConfig(): Promise<OpenClawConfig> {
  try {
    const content = await fs.readFile(OPENCLAW_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(content) as OpenClawConfig;
    return parsed;
  } catch {
    return {};
  }
}

export async function writeOpenClawConfig(config: OpenClawConfig): Promise<void> {
  try {
    await fs.mkdir(path.dirname(OPENCLAW_CONFIG_PATH), { recursive: true });
    await fs.writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new AppError(ErrorCodes.CONFIG_WRITE_FAILED, "Failed to write openclaw.json", error);
  }
}

export async function mergeAndWriteConfig(patch: Partial<OpenClawConfig>): Promise<OpenClawConfig> {
  const current = await readOpenClawConfig();

  if (patch.models !== undefined) {
    validateModelsConfig(patch.models);
  }

  const merged = deepMerge(current, patch);
  if (!isObject(merged)) {
    throw new AppError(ErrorCodes.CONFIG_WRITE_FAILED, "Merged config is not an object.");
  }

  await writeOpenClawConfig(merged as OpenClawConfig);
  return merged as OpenClawConfig;
}
