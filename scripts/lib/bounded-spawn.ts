import { spawn, type SpawnOptions, type ChildProcess } from "child_process";

export interface BoundedSpawnOptions extends SpawnOptions {
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  maxWallMs?: number;
  onStdoutChunk?: (chunk: Buffer) => void;
  onStderrChunk?: (chunk: Buffer) => void;
}

export interface BoundedSpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  killedByTimeout: boolean;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_WALL_MS = 30 * 60 * 1000;

class RollingBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;
  private discardedBytes = 0;
  constructor(private readonly max: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.byteLength;
    while (this.totalBytes > this.max && this.chunks.length > 1) {
      const head = this.chunks.shift()!;
      this.totalBytes -= head.byteLength;
      this.discardedBytes += head.byteLength;
    }
    if (this.chunks.length === 1 && this.chunks[0].byteLength > this.max) {
      const last = this.chunks[0];
      const trimmed = last.subarray(last.byteLength - this.max);
      this.discardedBytes += last.byteLength - trimmed.byteLength;
      this.chunks[0] = trimmed;
      this.totalBytes = trimmed.byteLength;
    }
  }

  toString(): string {
    const tail = Buffer.concat(this.chunks).toString("utf8");
    if (this.discardedBytes === 0) return tail;
    return `[bounded-spawn: discarded ${this.discardedBytes} earlier byte(s) — only the last ${this.totalBytes}B retained]\n${tail}`;
  }

  get truncated(): boolean { return this.discardedBytes > 0; }
}

export function boundedSpawn(
  command: string,
  args: string[],
  opts: BoundedSpawnOptions = {},
): Promise<BoundedSpawnResult> {
  const maxStdoutBytes = opts.maxStdoutBytes ?? DEFAULT_MAX_BYTES;
  const maxStderrBytes = opts.maxStderrBytes ?? DEFAULT_MAX_BYTES;
  const maxWallMs = opts.maxWallMs ?? DEFAULT_MAX_WALL_MS;
  const start = Date.now();

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    } catch (e) {
      reject(e);
      return;
    }

    const out = new RollingBuffer(maxStdoutBytes);
    const err = new RollingBuffer(maxStderrBytes);
    let killedByTimeout = false;

    const wallTimer = setTimeout(() => {
      killedByTimeout = true;
      try { child.kill("SIGTERM"); } catch (_e) { /* swallow */ }
      setTimeout(() => { try { child.kill("SIGKILL"); } catch (_e) { /* swallow */ } }, 5000).unref();
    }, maxWallMs);
    wallTimer.unref();

    child.stdout?.on("data", (c: Buffer) => {
      out.push(c);
      try { opts.onStdoutChunk?.(c); } catch (_e) { /* swallow */ }
    });
    child.stderr?.on("data", (c: Buffer) => {
      err.push(c);
      try { opts.onStderrChunk?.(c); } catch (_e) { /* swallow */ }
    });
    child.on("error", (e) => {
      clearTimeout(wallTimer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(wallTimer);
      resolve({
        code,
        signal,
        stdout: out.toString(),
        stderr: err.toString(),
        stdoutTruncated: out.truncated,
        stderrTruncated: err.truncated,
        durationMs: Date.now() - start,
        killedByTimeout,
      });
    });
  });
}
