import crypto from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomGroup(size: number): string {
  let out = "";
  for (let i = 0; i < size; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

export function generateLicenseKey(): string {
  return `FOC-${randomGroup(4)}-${randomGroup(4)}-${randomGroup(4)}`;
}

export function maskKey(key: string): string {
  if (key.length < 8) {
    return "****";
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}
