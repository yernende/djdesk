import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readServerConfig, type ServerConfig } from "./config.ts";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const configEnvironmentKeys = [
  "APP_MODE",
  "AUDIO_UPLOAD_DIR",
  "CHORDAI_KIT_ROOT",
  "DATABASE_PATH",
  "DJ_TOOL_ROOT",
  "FFPROBE_PATH",
  "HOST",
  "PORT",
  "PUBLIC_ORIGIN",
  "PUBLIC_SETS_PER_WORKSPACE",
  "PUBLIC_TRACKS_PER_SET",
  "PUBLIC_WORKSPACES_PER_DAY",
  "PUBLIC_WRITES_PER_MINUTE",
  "SEED_SAMPLE_DATA",
  "WINDOWS_FLASH_HOST",
  "WINDOWS_FLASH_STAGING_DIR",
  "YTDLP_PATH",
];

test("default paths are portable and rooted at the project", () => {
  const config = readServerConfig({});
  assert.equal(config.databasePath, join(projectRoot, "data/djdesk.sqlite"));
  assert.equal(config.audioUploadDir, join(projectRoot, "data/audio"));
  assert.equal(config.windowsFlashStagingDir, join(projectRoot, "data/windows-flash-import"));
  assert.equal(config.djToolRoot, resolve(projectRoot, "../dj"));
  assert.equal(config.chordAiKitRoot, resolve(projectRoot, "../chordai-pipeline-kit"));
  assert.equal(config.public, undefined);
  assert.equal(config.seedSampleData, false);
});

test("relative environment paths resolve from the project and absolute paths stay absolute", () => {
  const absoluteAudioPath = resolve(tmpdir(), "djdesk-config-audio");
  const config = readServerConfig({
    AUDIO_UPLOAD_DIR: absoluteAudioPath,
    CHORDAI_KIT_ROOT: "tools/chordai",
    DATABASE_PATH: "other/library.sqlite",
    DJ_TOOL_ROOT: "tools/dj",
    WINDOWS_FLASH_STAGING_DIR: "other/staging",
  });

  assert.equal(config.audioUploadDir, absoluteAudioPath);
  assert.equal(config.chordAiKitRoot, join(projectRoot, "tools/chordai"));
  assert.equal(config.databasePath, join(projectRoot, "other/library.sqlite"));
  assert.equal(config.djToolRoot, join(projectRoot, "tools/dj"));
  assert.equal(config.windowsFlashStagingDir, join(projectRoot, "other/staging"));
});

test("a missing root .env is optional when launched from another directory", async (t) => {
  const root = await createFixture(t);
  const config = runFixture<ServerConfig>(root, "console.log(JSON.stringify(readServerConfig()));");
  assert.equal(config.audioUploadDir, join(root, "data/audio"));
  assert.equal(config.port, 3000);
});

test("root .env loads once, preserves process values, and leaves injected environments alone", async (t) => {
  const root = await createFixture(t);
  await writeFile(
    join(root, ".env"),
    [
      "APP_MODE=public",
      "PUBLIC_ORIGIN=https://djdesk.example.com",
      "PORT=4100",
      "AUDIO_UPLOAD_DIR=custom/audio",
      "DATABASE_PATH=custom/library.sqlite",
      "YTDLP_PATH=custom-yt-dlp",
    ].join("\n"),
  );
  await writeFile(join(root, "other-directory/.env"), "PORT=4300\nAUDIO_UPLOAD_DIR=wrong/audio\n");

  const result = runFixture<{
    injected: ServerConfig;
    beforeLoad: string | null;
    loaded: ServerConfig;
    second: ServerConfig;
    ytDlpPath: string;
  }>(
    root,
    `
      const injected = readServerConfig({ PORT: "4400" });
      const beforeLoad = process.env.AUDIO_UPLOAD_DIR ?? null;
      const loaded = readServerConfig();
      delete process.env.AUDIO_UPLOAD_DIR;
      const second = readServerConfig(process.env);
      console.log(JSON.stringify({ injected, beforeLoad, loaded, second, ytDlpPath: process.env.YTDLP_PATH }));
    `,
    { PORT: "4200" },
  );

  assert.equal(result.injected.port, 4400);
  assert.equal(result.injected.audioUploadDir, join(root, "data/audio"));
  assert.equal(result.injected.public, undefined);
  assert.equal(result.beforeLoad, null);
  assert.equal(result.loaded.port, 4200);
  assert.equal(result.loaded.host, "127.0.0.1");
  assert.equal(result.loaded.public?.origin, "https://djdesk.example.com");
  assert.equal(result.loaded.audioUploadDir, join(root, "custom/audio"));
  assert.equal(result.loaded.databasePath, join(root, "custom/library.sqlite"));
  assert.equal(result.ytDlpPath, "custom-yt-dlp");
  assert.equal(result.second.audioUploadDir, join(root, "data/audio"));
});

test("unexpected .env read failures are reported instead of silently ignoring configuration", async (t) => {
  const root = await createFixture(t);
  await mkdir(join(root, ".env"));
  const result = runFixture<{ code?: string }>(
    root,
    `
      try {
        readServerConfig();
        console.log(JSON.stringify({}));
      } catch (error) {
        console.log(JSON.stringify({ code: error.code }));
      }
    `,
  );
  assert.ok(result.code);
  assert.notEqual(result.code, "ENOENT");
});

async function createFixture(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "djdesk-config-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "apps/server/src/public"), { recursive: true });
  await mkdir(join(root, "other-directory"));
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await copyFile(new URL("./config.ts", import.meta.url), join(root, "apps/server/src/config.ts"));
  await copyFile(
    new URL("./public/config.ts", import.meta.url),
    join(root, "apps/server/src/public/config.ts"),
  );
  return root;
}

function runFixture<T>(root: string, script: string, overrides: NodeJS.ProcessEnv = {}): T {
  const env = { ...process.env };
  for (const key of configEnvironmentKeys) delete env[key];
  const moduleUrl = pathToFileURL(join(root, "apps/server/src/config.ts")).href;
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { readServerConfig } from ${JSON.stringify(moduleUrl)};\n${script}`,
    ],
    { cwd: join(root, "other-directory"), encoding: "utf8", env: { ...env, ...overrides } },
  );
  return JSON.parse(output) as T;
}
