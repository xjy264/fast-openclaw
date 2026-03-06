import { buildDefaultModelSchema } from "./model-schema.js";
import { JsonStore } from "./store.js";
import type {
  LicenseEvent,
  LicenseRecord,
  ModelSchema,
  SessionEnvelope
} from "./types.js";
import { generateLicenseKey, nowIso, randomId, sha256 } from "./utils.js";

export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export interface ServiceConfig {
  resumeWindowHours: number;
  gatewayUrl?: string;
  gatewayToken?: string;
  modelSchema?: ModelSchema;
}

export interface SessionResponsePayload {
  sessionId: string;
  resumeToken: string;
  expiresAt: string;
  modelSchema: ModelSchema;
  gatewayDefaults?: {
    url?: string;
    token?: string;
  };
}

export interface PublicLicense {
  id: string;
  label: string;
  key: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  usedAt?: string;
  boundFingerprintHash?: string;
  resumeExpiresAt?: string;
  lastEvent?: LicenseEvent;
}

function parseDate(input?: string): number {
  if (!input) {
    return 0;
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeLicense(item: LicenseRecord): PublicLicense {
  return {
    id: item.id,
    label: item.label,
    key: item.key,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    usedAt: item.usedAt,
    boundFingerprintHash: item.boundFingerprintHash,
    resumeExpiresAt: item.resumeExpiresAt,
    lastEvent: item.events[item.events.length - 1]
  };
}

function buildSession(hours: number): SessionEnvelope {
  const sessionId = randomId("sess");
  const resumeToken = randomId("resume");
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  return { sessionId, resumeToken, expiresAt };
}

export class LicenseService {
  constructor(
    private readonly store: JsonStore,
    private readonly config: ServiceConfig
  ) {}

  private modelSchema(): ModelSchema {
    return this.config.modelSchema ?? buildDefaultModelSchema();
  }

  private payloadFromLicense(license: LicenseRecord): SessionResponsePayload {
    if (!license.sessionId || !license.resumeToken || !license.resumeExpiresAt) {
      throw new ServiceError("SESSION_INVALID", 500, "License 会话字段不完整。");
    }

    return {
      sessionId: license.sessionId,
      resumeToken: license.resumeToken,
      expiresAt: license.resumeExpiresAt,
      modelSchema: this.modelSchema(),
      gatewayDefaults: {
        url: this.config.gatewayUrl,
        token: this.config.gatewayToken
      }
    };
  }

  async createLicenses(count: number, label: string): Promise<PublicLicense[]> {
    if (!Number.isInteger(count) || count <= 0 || count > 200) {
      throw new ServiceError("COUNT_INVALID", 400, "count 必须是 1 到 200 之间的整数");
    }

    return this.store.withWrite((db) => {
      const created: PublicLicense[] = [];
      for (let i = 0; i < count; i += 1) {
        const key = generateLicenseKey();
        const now = nowIso();
        const record: LicenseRecord = {
          id: randomId("lic"),
          label,
          key,
          keyHash: sha256(key),
          status: "NEW",
          createdAt: now,
          updatedAt: now,
          events: []
        };
        db.licenses.push(record);
        created.push(sanitizeLicense(record));
      }
      return created;
    });
  }

  async listLicenses(): Promise<PublicLicense[]> {
    const db = await this.store.read();
    return db.licenses
      .slice()
      .sort((a, b) => parseDate(b.updatedAt) - parseDate(a.updatedAt))
      .map((item) => sanitizeLicense(item));
  }

  async disableLicense(id: string): Promise<PublicLicense> {
    return this.store.withWrite((db) => {
      const license = db.licenses.find((item) => item.id === id);
      if (!license) {
        throw new ServiceError("LICENSE_NOT_FOUND", 404, "未找到 License");
      }
      license.status = "DISABLED";
      license.updatedAt = nowIso();
      return sanitizeLicense(license);
    });
  }

  async resetLicense(id: string): Promise<PublicLicense> {
    return this.store.withWrite((db) => {
      const license = db.licenses.find((item) => item.id === id);
      if (!license) {
        throw new ServiceError("LICENSE_NOT_FOUND", 404, "未找到 License");
      }

      const nextKey = generateLicenseKey();
      license.key = nextKey;
      license.keyHash = sha256(nextKey);
      license.status = "NEW";
      license.boundFingerprintHash = undefined;
      license.sessionId = undefined;
      license.resumeToken = undefined;
      license.resumeExpiresAt = undefined;
      license.usedAt = undefined;
      license.lastError = undefined;
      license.events = [];
      license.updatedAt = nowIso();

      return sanitizeLicense(license);
    });
  }

  async startSession(licenseKey: string, fingerprintHash: string): Promise<SessionResponsePayload> {
    if (!licenseKey || !fingerprintHash) {
      throw new ServiceError("REQUEST_INVALID", 400, "licenseKey 和 deviceFingerprint 为必填");
    }

    return this.store.withWrite((db) => {
      const keyHash = sha256(licenseKey.trim());
      const license = db.licenses.find((item) => item.keyHash === keyHash);
      if (!license) {
        throw new ServiceError("LICENSE_INVALID", 401, "License Key 无效");
      }

      const now = Date.now();

      if (license.status === "DISABLED") {
        throw new ServiceError("LICENSE_DISABLED", 403, "License 已被禁用");
      }

      if (license.status === "USED") {
        throw new ServiceError("LICENSE_USED", 410, "License 已被使用");
      }

      if (license.status === "IN_USE") {
        if (license.boundFingerprintHash !== fingerprintHash) {
          throw new ServiceError("DEVICE_MISMATCH", 409, "License 已绑定其他设备");
        }

        const exp = parseDate(license.resumeExpiresAt);
        if (!exp || exp < now) {
          throw new ServiceError("RESUME_EXPIRED", 410, "License 会话已过期，请联系管理员重置");
        }

        return this.payloadFromLicense(license);
      }

      const session = buildSession(this.config.resumeWindowHours);
      license.status = "IN_USE";
      license.boundFingerprintHash = fingerprintHash;
      license.sessionId = session.sessionId;
      license.resumeToken = session.resumeToken;
      license.resumeExpiresAt = session.expiresAt;
      license.updatedAt = nowIso();

      return this.payloadFromLicense(license);
    });
  }

  async resumeSession(resumeToken: string, fingerprintHash: string): Promise<SessionResponsePayload> {
    if (!resumeToken || !fingerprintHash) {
      throw new ServiceError("REQUEST_INVALID", 400, "resumeToken 和 deviceFingerprint 为必填");
    }

    const db = await this.store.read();
    const license = db.licenses.find((item) => item.resumeToken === resumeToken);
    if (!license) {
      throw new ServiceError("SESSION_INVALID", 401, "resume token 无效");
    }

    if (license.status !== "IN_USE") {
      throw new ServiceError("SESSION_INVALID", 409, "当前 License 状态不可恢复");
    }

    if (license.boundFingerprintHash !== fingerprintHash) {
      throw new ServiceError("DEVICE_MISMATCH", 409, "resume token 已绑定其他设备");
    }

    const now = Date.now();
    const exp = parseDate(license.resumeExpiresAt);
    if (!exp || exp < now) {
      throw new ServiceError("RESUME_EXPIRED", 410, "resume token 已过期");
    }

    return this.payloadFromLicense(license);
  }

  async appendEvent(
    sessionId: string,
    resumeToken: string,
    stage: string,
    status: "started" | "succeeded" | "failed",
    message?: string,
    errorCode?: string
  ): Promise<void> {
    await this.store.withWrite((db) => {
      const license = db.licenses.find(
        (item) => item.sessionId === sessionId && item.resumeToken === resumeToken
      );
      if (!license) {
        throw new ServiceError("SESSION_INVALID", 401, "未找到会话");
      }

      license.events.push({
        at: nowIso(),
        stage,
        status,
        message,
        errorCode
      });

      if (license.events.length > 200) {
        license.events = license.events.slice(-200);
      }

      if (status === "failed") {
        license.lastError = message ?? errorCode ?? "未知错误";
      }

      license.updatedAt = nowIso();
    });
  }

  async completeSession(sessionId: string, resumeToken: string): Promise<void> {
    await this.store.withWrite((db) => {
      const license = db.licenses.find(
        (item) => item.sessionId === sessionId && item.resumeToken === resumeToken
      );
      if (!license) {
        throw new ServiceError("SESSION_INVALID", 401, "未找到会话");
      }

      if (license.status !== "IN_USE") {
        throw new ServiceError("SESSION_INVALID", 409, "当前会话状态不可完成");
      }

      license.status = "USED";
      license.usedAt = nowIso();
      license.resumeToken = undefined;
      license.resumeExpiresAt = undefined;
      license.updatedAt = nowIso();
    });
  }
}
