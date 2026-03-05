import crypto from "node:crypto";
import os from "node:os";
import { runCommand } from "./exec.js";
import type { DeviceFingerprint } from "./types.js";

async function readMacSerial(): Promise<string> {
  const result = await runCommand("bash", ["-lc", "ioreg -rd1 -c IOPlatformExpertDevice | awk '/IOPlatformUUID/ {print $3}'"], {
    shell: false
  });
  if (result.code !== 0 || !result.stdout) {
    return "unknown-serial";
  }
  return result.stdout.replace(/\"/g, "").trim();
}

export async function buildDeviceFingerprint(): Promise<DeviceFingerprint> {
  const serial = await readMacSerial();
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const raw = `${serial}|${hostname}|${username}`;
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}
