export type LicenseStatus = "NEW" | "IN_USE" | "USED" | "DISABLED";

export interface LicenseEvent {
  at: string;
  stage: string;
  status: "started" | "succeeded" | "failed";
  message?: string;
  errorCode?: string;
}

export interface LicenseRecord {
  id: string;
  label: string;
  key: string;
  keyHash: string;
  status: LicenseStatus;
  createdAt: string;
  updatedAt: string;
  boundFingerprintHash?: string;
  sessionId?: string;
  resumeToken?: string;
  resumeExpiresAt?: string;
  usedAt?: string;
  lastError?: string;
  events: LicenseEvent[];
}

export interface DataStoreSchema {
  licenses: LicenseRecord[];
}

export interface SessionEnvelope {
  sessionId: string;
  resumeToken: string;
  expiresAt: string;
}

export interface FieldOption {
  label: string;
  value: string;
}

export type FieldType = "string" | "password" | "number" | "boolean" | "select";

export interface SchemaField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
  default?: string | number | boolean;
  options?: FieldOption[];
}

export interface ModelOption {
  id: string;
  name: string;
  description?: string;
  configTemplate: Record<string, unknown>;
  fields: SchemaField[];
}

export interface ModelSchema {
  mode: "merge" | "replace";
  options: ModelOption[];
}
