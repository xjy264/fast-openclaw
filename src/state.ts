import fs from "node:fs/promises";
import path from "node:path";
import { SETUP_STATE_PATH } from "./constants.js";
import type { SetupPhase, SetupState } from "./types.js";

export async function readSetupState(): Promise<SetupState | null> {
  try {
    const content = await fs.readFile(SETUP_STATE_PATH, "utf8");
    return JSON.parse(content) as SetupState;
  } catch {
    return null;
  }
}

export async function saveSetupState(
  partial: Omit<SetupState, "updatedAt"> & { updatedAt?: string }
): Promise<void> {
  await fs.mkdir(path.dirname(SETUP_STATE_PATH), { recursive: true });
  const nextState: SetupState = {
    ...partial,
    updatedAt: partial.updatedAt ?? new Date().toISOString()
  };
  await fs.writeFile(SETUP_STATE_PATH, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

export async function advancePhase(
  previous: SetupState,
  phase: SetupPhase,
  patch?: Partial<SetupState>
): Promise<SetupState> {
  const nextState: SetupState = {
    ...previous,
    ...patch,
    phase,
    updatedAt: new Date().toISOString()
  };
  await saveSetupState(nextState);
  return nextState;
}

export async function clearSetupState(): Promise<void> {
  try {
    await fs.unlink(SETUP_STATE_PATH);
  } catch {
    // Ignore missing file.
  }
}
