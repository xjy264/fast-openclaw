export type SetupPhase =
  | "init"
  | "license_validated"
  | "installed"
  | "onboarded"
  | "configured"
  | "gateway_verified"
  | "completed";

export interface CliOptions {
  apiBase?: string;
  resume?: string;
  debug?: boolean;
}

export interface TelemetryEvent {
  stage: SetupPhase | "error";
  status: "started" | "succeeded" | "failed";
  message?: string;
  errorCode?: string;
}

export interface DeviceFingerprint {
  raw: string;
  hash: string;
}

export interface SessionStartRequest {
  licenseKey: string;
  deviceFingerprint: string;
  cliVersion: string;
  platform: string;
}

export interface SessionResumeRequest {
  resumeToken: string;
  deviceFingerprint: string;
  cliVersion: string;
  platform: string;
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
  mode?: "merge" | "replace";
  options: ModelOption[];
}

export interface GatewayDefaults {
  url?: string;
  token?: string;
}

export interface SessionPayload {
  sessionId: string;
  resumeToken: string;
  expiresAt?: string;
  modelSchema: ModelSchema;
  gatewayDefaults?: GatewayDefaults;
}

export interface SessionResponse {
  ok: boolean;
  payload: SessionPayload;
}

export interface SessionEventRequest {
  sessionId: string;
  resumeToken: string;
  event: TelemetryEvent;
}

export interface SessionCompleteRequest {
  sessionId: string;
  resumeToken: string;
  resultSummary: {
    openclawVersion: string;
    gatewayUrl: string;
    browserEnabled: boolean;
    modelId: string;
  };
}

export interface SetupState {
  sessionId: string;
  resumeToken: string;
  phase: SetupPhase;
  modelId?: string;
  openclawVersion?: string;
  gatewayUrl?: string;
  browserEnabled?: boolean;
  deviceFingerprintHash: string;
  updatedAt: string;
}

export interface OpenClawConfig {
  models?: Record<string, unknown>;
  browser?: {
    enabled: boolean;
    defaultProfile: string;
    executablePath?: string;
  };
  [key: string]: unknown;
}

export interface InteractiveModelResult {
  modelId: string;
  modelName: string;
  modelsConfig: Record<string, unknown>;
}
