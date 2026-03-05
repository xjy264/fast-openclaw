export class AppError extends Error {
  public readonly code: string;
  public readonly causeValue?: unknown;

  constructor(code: string, message: string, causeValue?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.causeValue = causeValue;
  }
}

export const ErrorCodes = {
  API_BASE_MISSING: "API_BASE_MISSING",
  PLATFORM_NOT_SUPPORTED: "PLATFORM_NOT_SUPPORTED",
  LICENSE_INVALID: "LICENSE_INVALID",
  SESSION_INVALID: "SESSION_INVALID",
  INSTALL_FAILED: "INSTALL_FAILED",
  VERSION_NOT_FOUND: "VERSION_NOT_FOUND",
  PATH_FIX_FAILED: "PATH_FIX_FAILED",
  ONBOARD_FAILED: "ONBOARD_FAILED",
  CONFIG_SCHEMA_INVALID: "CONFIG_SCHEMA_INVALID",
  CONFIG_VALIDATION_FAILED: "CONFIG_VALIDATION_FAILED",
  CONFIG_WRITE_FAILED: "CONFIG_WRITE_FAILED",
  GATEWAY_FAILED: "GATEWAY_FAILED",
  AGENT_CHECK_FAILED: "AGENT_CHECK_FAILED",
  NETWORK_FAILED: "NETWORK_FAILED",
  UNKNOWN: "UNKNOWN"
} as const;
