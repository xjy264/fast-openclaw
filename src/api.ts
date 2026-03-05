import { AppError, ErrorCodes } from "./errors.js";
import type {
  SessionCompleteRequest,
  SessionEventRequest,
  SessionResponse,
  SessionResumeRequest,
  SessionStartRequest
} from "./types.js";

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  async startSession(payload: SessionStartRequest): Promise<SessionResponse> {
    return this.post<SessionResponse>("/v1/setup/session/start", payload, ErrorCodes.LICENSE_INVALID);
  }

  async resumeSession(payload: SessionResumeRequest): Promise<SessionResponse> {
    return this.post<SessionResponse>("/v1/setup/session/resume", payload, ErrorCodes.SESSION_INVALID);
  }

  async sendEvent(payload: SessionEventRequest): Promise<void> {
    await this.post<{ ok: boolean }>("/v1/setup/session/events", payload, ErrorCodes.NETWORK_FAILED, true);
  }

  async completeSession(payload: SessionCompleteRequest): Promise<void> {
    await this.post<{ ok: boolean }>("/v1/setup/session/complete", payload, ErrorCodes.NETWORK_FAILED);
  }

  private async post<T>(
    path: string,
    payload: unknown,
    errorCode: string,
    swallowFailure = false
  ): Promise<T> {
    const url = new URL(path, this.baseUrl).toString();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = await response.text();
        throw new AppError(errorCode, `HTTP ${response.status}: ${body || response.statusText}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (swallowFailure) {
        return { ok: false } as T;
      }
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(errorCode, `Request failed for ${path}`, error);
    }
  }
}
