#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";
import { LicenseService, ServiceError } from "./license-service.js";
import { JsonStore } from "./store.js";

const port = Number(process.env.PORT ?? "8787");
const host = process.env.HOST ?? "0.0.0.0";
const adminToken = process.env.FAST_OPENCLAW_ADMIN_TOKEN ?? "change-me";
const resumeWindowHours = Number(process.env.FAST_OPENCLAW_RESUME_HOURS ?? "24");
const gatewayUrl = process.env.FAST_OPENCLAW_GATEWAY_URL;
const gatewayToken = process.env.FAST_OPENCLAW_GATEWAY_TOKEN;
const dataFile = process.env.FAST_OPENCLAW_DATA_FILE ?? path.resolve(process.cwd(), ".data", "store.json");
const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const adminHtmlPath = path.resolve(runtimeDir, "../../public/admin.html");

const store = new JsonStore(dataFile);
const service = new LicenseService(store, {
  resumeWindowHours,
  gatewayUrl,
  gatewayToken
});

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

function handleError(res: Response, error: unknown): void {
  if (error instanceof ServiceError) {
    res.status(error.status).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message
      }
    });
    return;
  }

  const message = error instanceof Error ? error.message : "unknown server error";
  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message
    }
  });
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token || token !== adminToken) {
    res.status(401).json({
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "admin token invalid"
      }
    });
    return;
  }
  next();
}

function oneParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "fast-openclaw-server",
    admin: "/admin",
    health: "/health"
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, status: "up" });
});

app.get("/admin", (_req, res) => {
  res.sendFile(adminHtmlPath);
});

app.post("/v1/setup/session/start", async (req, res) => {
  try {
    const { licenseKey, deviceFingerprint } = req.body ?? {};
    const payload = await service.startSession(String(licenseKey ?? ""), String(deviceFingerprint ?? ""));
    res.json({ ok: true, payload });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/v1/setup/session/resume", async (req, res) => {
  try {
    const { resumeToken, deviceFingerprint } = req.body ?? {};
    const payload = await service.resumeSession(String(resumeToken ?? ""), String(deviceFingerprint ?? ""));
    res.json({ ok: true, payload });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/v1/setup/session/events", async (req, res) => {
  try {
    const { sessionId, resumeToken, event } = req.body ?? {};
    const eventStatus =
      event?.status === "started" || event?.status === "succeeded" || event?.status === "failed"
        ? event.status
        : "started";
    await service.appendEvent(
      String(sessionId ?? ""),
      String(resumeToken ?? ""),
      String(event?.stage ?? ""),
      eventStatus,
      typeof event?.message === "string" ? event.message : undefined,
      typeof event?.errorCode === "string" ? event.errorCode : undefined
    );
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/v1/setup/session/complete", async (req, res) => {
  try {
    const { sessionId, resumeToken } = req.body ?? {};
    await service.completeSession(String(sessionId ?? ""), String(resumeToken ?? ""));
    res.json({ ok: true });
  } catch (error) {
    handleError(res, error);
  }
});

app.get("/admin/api/licenses", requireAdmin, async (_req, res) => {
  try {
    const licenses = await service.listLicenses();
    res.json({ ok: true, licenses });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/admin/api/licenses", requireAdmin, async (req, res) => {
  try {
    const count = Number(req.body?.count ?? 1);
    const label = String(req.body?.label ?? "default");
    const licenses = await service.createLicenses(count, label);
    res.json({ ok: true, licenses });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/admin/api/licenses/:id/disable", requireAdmin, async (req, res) => {
  try {
    const license = await service.disableLicense(oneParam(req.params.id));
    res.json({ ok: true, license });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/admin/api/licenses/:id/reset", requireAdmin, async (req, res) => {
  try {
    const license = await service.resetLicense(oneParam(req.params.id));
    res.json({ ok: true, license });
  } catch (error) {
    handleError(res, error);
  }
});

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`fast-openclaw-server listening on http://${host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`admin page: http://${host}:${port}/admin`);
  // eslint-disable-next-line no-console
  console.log(`data file: ${dataFile}`);
});
