import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface CommandResult {
  code: number;
  stderr: string;
  stdout: string;
}

export interface RunCommandOptions {
  check?: boolean;
  cwd?: string;
  input?: string | Buffer;
  timeoutMs?: number;
}

const defaultTimeoutMs = 120_000;
const maxPhoneCleanupTargets = [
  "/sdcard/Music/djdesk*",
  "/sdcard/Music/yandex-*",
  "/sdcard/Music/spotify-*",
  "/sdcard/Music/djdesk-windows-import*",
];

export async function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const check = options.check !== false;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: "pipe",
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(" ")}`));
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const result: CommandResult = {
        code: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      };

      if (check && result.code !== 0) {
        reject(
          new Error(
            [
              `Command failed (${result.code}): ${command} ${args.join(" ")}`,
              result.stdout.trim(),
              result.stderr.trim(),
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        );
        return;
      }

      resolve(result);
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

export async function runSftpBatch(
  host: string,
  commands: readonly string[],
  options: Omit<RunCommandOptions, "input"> = {},
): Promise<string> {
  const input = `${commands.join("\n")}\n`;
  const result = await runCommand("sftp", ["-b", "-", host], {
    ...options,
    input,
  });

  return result.stdout;
}

export async function listRemoteFiles(host: string, remoteDir: string): Promise<string[]> {
  const output = await runSftpBatch(host, [`ls -1 ${quoteSftp(remoteDir)}`], {
    timeoutMs: 120_000,
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("sftp>"))
    .filter((line) => line.startsWith(`${remoteDir}/`))
    .sort((first, second) => first.localeCompare(second, undefined, { sensitivity: "base" }));
}

export async function downloadRemoteFile(
  host: string,
  remotePath: string,
  localPath: string,
): Promise<void> {
  await mkdir(dirname(localPath), {
    recursive: true,
  });
  await runSftpBatch(host, [`get ${quoteSftp(remotePath)} ${quoteSftp(localPath)}`], {
    timeoutMs: 600_000,
  });
}

export async function adbShell(
  args: readonly string[],
  options: Omit<RunCommandOptions, "input"> = {},
): Promise<string> {
  const result = await runCommand("adb", ["shell", ...args], options);

  return result.stdout;
}

export async function adbPush(localPath: string, phonePath: string): Promise<void> {
  await adbShell(["mkdir", "-p", dirname(phonePath)], {
    timeoutMs: 60_000,
  });
  await runCommand("adb", ["push", localPath, phonePath], {
    timeoutMs: 600_000,
  });
}

export async function adbRemove(paths: readonly string[]): Promise<void> {
  const filteredPaths = paths.map((path) => path.trim()).filter(Boolean);

  if (filteredPaths.length === 0) {
    return;
  }

  const script = filteredPaths
    .map((path) => `rm -f -- ${quotePosixShell(path)} 2>/dev/null || true`)
    .join("; ");

  await adbShell(["sh", "-c", script], {
    check: false,
    timeoutMs: 120_000,
  }).catch(() => undefined);
}

export async function adbCleanupManagedMedia(): Promise<void> {
  await adbShell(
    [
      "sh",
      "-c",
      [
        `rm -rf ${maxPhoneCleanupTargets.join(" ")} 2>/dev/null || true`,
        "mkdir -p /sdcard/Download/chordai_exports 2>/dev/null || true",
        "rm -f /sdcard/Download/chordai_exports/*.chordai 2>/dev/null || true",
      ].join("; "),
    ],
    {
      check: false,
      timeoutMs: 180_000,
    },
  ).catch(() => undefined);
}

export async function adbCleanupChordAiExports(): Promise<void> {
  await adbShell(
    [
      "sh",
      "-c",
      [
        "mkdir -p /sdcard/Download/chordai_exports 2>/dev/null || true",
        "rm -f /sdcard/Download/chordai_exports/*.chordai 2>/dev/null || true",
      ].join("; "),
    ],
    {
      check: false,
      timeoutMs: 120_000,
    },
  ).catch(() => undefined);
}

export async function readPhoneFreeKilobytes(): Promise<number | null> {
  const output = await adbShell(["df", "-k", "/sdcard"], {
    check: false,
    timeoutMs: 30_000,
  });
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const dataLine = lines.at(-1);

  if (!dataLine) {
    return null;
  }

  const columns = dataLine.split(/\s+/);
  const available = columns.at(-2);

  if (!available) {
    return null;
  }

  const parsed = Number.parseInt(available, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function quoteSftp(value: string): string {
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}

function quotePosixShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
