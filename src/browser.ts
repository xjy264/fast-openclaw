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
        "未在 /Applications/Google Chrome.app 找到 Chrome。已跳过浏览器配置。安装 Chrome 后可重新执行 gateway restart。"
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
    message: "已检测到 Chrome，已写入独立浏览器配置档。"
  };
}
