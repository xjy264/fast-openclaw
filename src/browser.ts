import fs from "node:fs/promises";
import { CHROME_EXECUTABLE_PATH } from "./constants.js";
import type { OpenClawConfig } from "./types.js";

export interface BrowserSetupResult {
  enabled: boolean;
  patch?: Partial<OpenClawConfig>;
  message: string;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function buildBrowserConfigPatch(): Promise<BrowserSetupResult> {
  const chromeExists = await fileExists(CHROME_EXECUTABLE_PATH);

  if (!chromeExists) {
    return {
      enabled: false,
      message:
        "Chrome not found at /Applications/Google Chrome.app. Skipping browser config. Install Chrome later and re-run gateway restart."
    };
  }

  return {
    enabled: true,
    patch: {
      browser: {
        enabled: true,
        defaultProfile: "openclaw",
        executablePath: CHROME_EXECUTABLE_PATH
      }
    },
    message: "Chrome detected. Browser isolated profile configured."
  };
}
