import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function waitForAnalyzerDirectory(sourceName: string): Promise<string> {
  const expiresAt = Date.now() + 4_000;
  while (Date.now() < expiresAt) {
    for (const entry of await readdir(tmpdir())) {
      if (!entry.startsWith("eve-biome-review-")) {
        continue;
      }
      const directory = join(tmpdir(), entry);
      try {
        await access(join(directory, "snapshot", sourceName));
        return directory;
      } catch {
        // The target analyzer snapshot is not ready yet.
      }
    }
    await delay(5);
  }
  throw new Error("Timed out waiting for the CLI analyzer process to start.");
}

test("maps SIGINT and SIGTERM to typed cancellation and waits for analyzer cleanup", {
  skip: process.platform !== "linux",
}, async () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "eve-review-signal-"));
    const sourceRoot = join(temporaryDirectory, "source");
    const sourceName = `${basename(temporaryDirectory)}.ts`;
    const sourcePath = join(sourceRoot, sourceName);
    const diffPath = join(temporaryDirectory, "change.diff");
    const lines = Array.from({ length: 10_000 }, (_, index) => `const value${String(index)} = 0;`);
    const source = `${lines.join("\n")}\n`;
    await mkdir(sourceRoot);
    await writeFile(sourcePath, source);
    await writeFile(
      diffPath,
      [
        "--- /dev/null",
        `+++ b/${sourceName}`,
        `@@ -0,0 +1,${String(lines.length)} @@`,
        ...lines.map((line) => `+${line}`),
        "",
      ].join("\n"),
    );

    const child = spawn(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const completion = new Promise<number | null>((resolveCompletion) => {
      child.once("close", resolveCompletion);
    });

    let analyzerDirectory: string | undefined;
    try {
      analyzerDirectory = await waitForAnalyzerDirectory(sourceName);
      child.kill(signal);
      const exitCode = await completion;

      assert.equal(exitCode, 1);
      assert.equal(Buffer.concat(stdout).toString("utf8"), "");
      assert.equal(
        Buffer.concat(stderr).toString("utf8"),
        '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"cancelled","stage":"analyze"},"ok":false},"schemaVersion":1}\n',
      );
      await assert.rejects(
        access(analyzerDirectory),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await completion;
      }
      if (analyzerDirectory !== undefined) {
        await rm(analyzerDirectory, { recursive: true, force: true });
      }
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

test("cancels a blocked diff stream and closes the one-shot CLI", {
  skip: process.platform !== "linux",
}, async () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "eve-review-diff-signal-"));
  const diffPath = join(temporaryDirectory, "change.pipe");
  assert.equal(spawnSync("mkfifo", [diffPath]).status, 0);

  const child = spawn(
    process.execPath,
    [cliPath, "--repository", "acme/widgets", "--pull-request", "17", diffPath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const writer = spawn(
    process.execPath,
    [
      "-e",
      [
        'const { createWriteStream } = require("node:fs");',
        "const stream = createWriteStream(process.argv[1]);",
        'stream.on("open", () => { stream.write("diff --git a/a.ts b/a.ts\\n"); process.stdout.write("ready\\n"); });',
        'stream.on("error", () => process.exit(0));',
      ].join(" "),
      diffPath,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const completion = new Promise<number | null>((resolveCompletion) => {
    child.once("close", resolveCompletion);
  });
  const writerCompletion = new Promise<void>((resolveCompletion) => {
    writer.once("close", () => resolveCompletion());
  });
  const writerReady = new Promise<void>((resolveReady) => {
    writer.stdout.once("data", () => resolveReady());
  });

  try {
    await writerReady;
    child.kill("SIGTERM");
    const exitCode = await Promise.race([
      completion,
      delay(1_000, undefined, { ref: false }).then(() => {
        throw new Error("CLI did not close after cancelling diff input");
      }),
    ]);

    assert.equal(exitCode, 1);
    assert.equal(
      Buffer.concat(stderr).toString("utf8"),
      '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"cancelled","stage":"start"},"ok":false},"schemaVersion":1}\n',
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await completion;
    }
    if (writer.exitCode === null && writer.signalCode === null) {
      writer.kill("SIGKILL");
      await writerCompletion;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
