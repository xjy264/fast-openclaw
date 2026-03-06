import { confirm, input, password, select } from "@inquirer/prompts";
import { AppError, ErrorCodes } from "./errors.js";
import type { InteractiveModelResult, ModelOption, ModelSchema, SchemaField } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function interpolateValue(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
      const replacement = values[key];
      return replacement === undefined || replacement === null ? "" : String(replacement);
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, values));
  }

  if (isObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = interpolateValue(nested, values);
    }
    return next;
  }

  return value;
}

function envKeyForField(fieldKey: string): string {
  const snake = fieldKey
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase();
  return `FAST_OPENCLAW_MODEL_${snake}`;
}

function coerceTextValue(field: SchemaField, value: string): string | number | boolean {
  if (field.type === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new AppError(
        ErrorCodes.CONFIG_VALIDATION_FAILED,
        `环境变量 ${envKeyForField(field.key)} 必须是数字。`
      );
    }
    return parsed;
  }

  if (field.type === "boolean") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
    throw new AppError(
      ErrorCodes.CONFIG_VALIDATION_FAILED,
      `环境变量 ${envKeyForField(field.key)} 必须是布尔值。`
    );
  }

  return value;
}

function resolvePrefilledFieldValue(field: SchemaField): unknown {
  const envKey = envKeyForField(field.key);
  const envValue = process.env[envKey];
  if (typeof envValue === "string" && envValue.trim()) {
    return coerceTextValue(field, envValue.trim());
  }

  if (field.default !== undefined) {
    return field.default;
  }

  return undefined;
}

async function askField(field: SchemaField): Promise<unknown> {
  const message = field.required ? `${field.label}（必填）` : field.label;

  switch (field.type) {
    case "password":
      return password({
        message,
        mask: "*",
        validate: (value) => {
          if (field.required && !value.trim()) {
            return `请填写：${field.label}`;
          }
          return true;
        }
      });

    case "boolean":
      return confirm({
        message,
        default: Boolean(field.default ?? false)
      });

    case "select": {
      if (!field.options || field.options.length === 0) {
        throw new AppError(
          ErrorCodes.CONFIG_SCHEMA_INVALID,
          `下拉字段 ${field.key} 缺少 options 配置。`
        );
      }
      return select({
        message,
        choices: field.options.map((option) => ({ name: option.label, value: option.value }))
      });
    }

    case "number": {
      const raw = await input({
        message,
        default: field.default !== undefined ? String(field.default) : undefined,
        validate: (value) => {
          if (!value.trim()) {
            return field.required ? `请填写：${field.label}` : true;
          }
          return Number.isFinite(Number(value)) || `${field.label} 必须是数字`;
        }
      });
      if (!raw.trim()) {
        return undefined;
      }
      return Number(raw);
    }

    case "string":
    default:
      return input({
        message,
        default: field.default !== undefined ? String(field.default) : undefined,
        validate: (value) => {
          if (field.required && !value.trim()) {
            return `请填写：${field.label}`;
          }
          return true;
        }
      });
  }
}

function validateModelsNode(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      validateModelsNode(item);
    }
    return;
  }

  if (!isObject(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "models" && Array.isArray(value)) {
      for (const entry of value) {
        if (!isObject(entry)) {
          throw new AppError(
            ErrorCodes.CONFIG_VALIDATION_FAILED,
            "models[] 每个条目都必须是对象，并包含 id 和 name。"
          );
        }
        const id = entry.id;
        const name = entry.name;
        if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
          throw new AppError(
            ErrorCodes.CONFIG_VALIDATION_FAILED,
            "models[] 条目必须同时包含非空 id 和 name。"
          );
        }
      }
    }
    validateModelsNode(value);
  }
}

function assertSchema(schema: ModelSchema): void {
  if (!schema || !Array.isArray(schema.options) || schema.options.length === 0) {
    throw new AppError(ErrorCodes.CONFIG_SCHEMA_INVALID, "后端返回的模型 schema 为空。");
  }

  for (const option of schema.options) {
    if (!option.id || !option.name || !option.configTemplate || !Array.isArray(option.fields)) {
      throw new AppError(
        ErrorCodes.CONFIG_SCHEMA_INVALID,
        "模型 schema 选项缺少 id/name/configTemplate/fields。"
      );
    }
  }
}

export async function collectModelConfig(schema: ModelSchema): Promise<InteractiveModelResult> {
  assertSchema(schema);

  const selected: ModelOption =
    schema.options.length === 1
      ? schema.options[0]
      : await select<ModelOption>({
          message: "请选择模型预设",
          choices: schema.options.map((option) => ({
            name: option.description ? `${option.name} - ${option.description}` : option.name,
            value: option
          }))
        });

  const values: Record<string, unknown> = {};
  for (const field of selected.fields) {
    const prefilled = resolvePrefilledFieldValue(field);
    if (prefilled !== undefined) {
      values[field.key] = prefilled;
      continue;
    }

    if (field.required) {
      values[field.key] = await askField(field);
      continue;
    }

    values[field.key] = undefined;
  }

  const modelsConfig = interpolateValue(selected.configTemplate, values);
  validateModelsNode(modelsConfig);

  if (!isObject(modelsConfig)) {
    throw new AppError(ErrorCodes.CONFIG_VALIDATION_FAILED, "生成的模型配置必须是对象。");
  }

  return {
    modelId: selected.id,
    modelName: selected.name,
    modelsConfig
  };
}

export function validateModelsConfig(modelsConfig: unknown): void {
  validateModelsNode(modelsConfig);
}

export function renderTemplate(template: Record<string, unknown>, values: Record<string, unknown>): Record<string, unknown> {
  const interpolated = interpolateValue(template, values);
  if (!isObject(interpolated)) {
    throw new AppError(ErrorCodes.CONFIG_VALIDATION_FAILED, "模板渲染后的配置必须是对象。");
  }
  return interpolated;
}
