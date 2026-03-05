import { spawn } from "node:child_process";
import { AppError, ErrorCodes } from "./errors.js";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(
  command: string,
  args: string[],
  options?: {
    shell?: boolean;
    inheritStdio?: boolean;
    env?: NodeJS.ProcessEnv;
  }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options?.inheritStdio ? "inherit" : "pipe",
      shell: options?.shell ?? false,
      env: options?.env ?? process.env
    });

    let stdout = "";
    let stderr = "";

    if (!options?.inheritStdio) {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({
          code: 127,
          stdout: "",
          stderr: `${command}: command not found`
        });
        return;
      }
      reject(new AppError(ErrorCodes.UNKNOWN, `Command failed to start: ${command}`, error));
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}
