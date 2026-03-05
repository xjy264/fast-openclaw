import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LicenseService, ServiceError } from "../src/server/license-service.js";
import { JsonStore } from "../src/server/store.js";

const tempDirs: string[] = [];

async function createService() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "foc-test-"));
  tempDirs.push(dir);
  const store = new JsonStore(path.join(dir, "store.json"));
  const service = new LicenseService(store, {
    resumeWindowHours: 24,
    gatewayUrl: "http://localhost:18789",
    gatewayToken: "g-token"
  });
  return service;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe("LicenseService", () => {
  it("creates license and starts session", async () => {
    const service = await createService();
    const [license] = await service.createLicenses(1, "test");

    const session = await service.startSession(license.key, "fp1");

    expect(session.sessionId).toContain("sess_");
    expect(session.resumeToken).toContain("resume_");
    expect(session.modelSchema.options.length).toBeGreaterThan(0);
  });

  it("binds session to first fingerprint", async () => {
    const service = await createService();
    const [license] = await service.createLicenses(1, "test");

    await service.startSession(license.key, "fp1");

    await expect(service.startSession(license.key, "fp2")).rejects.toMatchObject<ServiceError>({
      code: "DEVICE_MISMATCH"
    });
  });

  it("burns key on complete", async () => {
    const service = await createService();
    const [license] = await service.createLicenses(1, "test");

    const session = await service.startSession(license.key, "fp1");
    await service.completeSession(session.sessionId, session.resumeToken);

    await expect(service.startSession(license.key, "fp1")).rejects.toMatchObject<ServiceError>({
      code: "LICENSE_USED"
    });
  });
});
