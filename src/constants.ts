import os from "node:os";
import path from "node:path";

export const OPENCLAW_INSTALL_CMD = "curl -fsSL https://openclaw.ai/install.sh | bash";
export const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), ".openclaw", "openclaw.json");
export const SETUP_STATE_PATH = path.join(os.homedir(), ".openclaw", "setup-state.json");

export const PATH_EXPORT_LINES = [
  'export PATH="$(npm prefix -g)/bin:$PATH"',
  'export PATH="$HOME/.local/bin:$PATH"'
];

export const CHROME_EXECUTABLE_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export const DEFAULT_GATEWAY_URL = "http://localhost:18789";
