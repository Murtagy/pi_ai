import { spawn } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  signal: AbortSignal;
  // Inspection commands inherit the reviewer's process group so outer cancellation owns them.
  inheritProcessGroup?: boolean;
  input?: string;
  outputPath?: string;
  onLine?: (line: string) => void;
}

export function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PI_SESSION_") || key.startsWith("GIT_") ||
        ["PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL", "PI_CODING_AGENT_SESSION_DIR"].includes(key)) {
      delete env[key];
    }
  }
  return env;
}

// Own the process group until close, including descendants holding inherited pipes.
export async function runProcess(request: ProcessRequest): Promise<string> {
  request.signal.throwIfAborted();
  const fd = request.outputPath ? openSync(request.outputPath, "w", 0o600) : undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const ownGroup = process.platform !== "win32" && !request.inheritProcessGroup;
      const child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: cleanEnvironment(),
        shell: false,
        detached: ownGroup,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let pending = "";
      let failure: Error | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (signal: NodeJS.Signals): void => {
        try {
          if (ownGroup && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
            failure ??= error instanceof Error ? error : new Error(String(error));
          }
        }
      };
      const stop = (): void => {
        if (killTimer) return;
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1000);
      };
      const abort = (): void => {
        failure ??= new Error(`Review cancelled: ${String(request.signal.reason)}`);
        stop();
      };
      const processLine = (line: string): void => {
        try { request.onLine?.(line); }
        catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
          stop();
        }
      };
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        try {
          if (fd !== undefined) writeSync(fd, chunk);
          if (request.onLine) {
            pending += chunk;
            let newline: number;
            while ((newline = pending.indexOf("\n")) !== -1) {
              processLine(pending.slice(0, newline));
              pending = pending.slice(newline + 1);
            }
            if (pending.length > 16 * 1024 * 1024) throw new Error("Reviewer JSON record exceeds 16 MiB");
          } else {
            stdout += chunk;
            if (stdout.length > 32 * 1024 * 1024) throw new Error("Process output exceeds 32 MiB");
          }
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
          stop();
        }
      });
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-16000); });
      child.on("error", (error) => { failure ??= error; });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") { failure ??= error; stop(); }
      });
      child.on("close", (code, signal) => {
        if (request.onLine && pending.trim()) processLine(pending);
        request.signal.removeEventListener("abort", abort);
        if (killTimer) {
          clearTimeout(killTimer);
          // The leader may exit before descendants that ignored SIGTERM.
          kill("SIGKILL");
        }
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`${request.command} failed (${code ?? signal}): ${stderr || stdout.slice(-4000)}`));
        else resolve(stdout);
      });
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      child.stdin.end(request.input ?? "");
    });
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
