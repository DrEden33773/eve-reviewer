import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function guarded<T>(pending: Promise<T>, state: string, milliseconds = 4_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${state}`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`maps ${signal} to typed cancellation and waits for analyzer cleanup`, {
    skip: process.platform !== "linux",
    timeout: 10_000,
  }, async () => {
    const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
    const preload = fileURLToPath(new URL("./analyzer-preload.mjs", import.meta.url));
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "eve-review-signal-"));
    const sourceRoot = join(temporaryDirectory, "source");
    const diffPath = join(temporaryDirectory, "change.diff");
    await mkdir(sourceRoot);
    await writeFile(join(sourceRoot, "value.ts"), "eval(input);\n");
    await writeFile(diffPath, "--- /dev/null\n+++ b/value.ts\n@@ -0,0 +1 @@\n+eval(input);\n");

    const child = spawn(
      process.execPath,
      [
        "--import",
        preload,
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let cliClosed = false;
    const completion = new Promise<number | null>((resolveCompletion) => {
      child.once("close", (code) => {
        cliClosed = true;
        resolveCompletion(code);
      });
    });
    let analyzer: { pid: number; directory: string } | undefined;
    let analyzerHasClosed = false;
    try {
      const [message] = await guarded(
        Promise.race([
          once(child, "message"),
          completion.then(() => {
            throw new Error("CLI closed before analyzer readiness");
          }),
        ]),
        "analyzer IPC readiness",
      );
      assert.equal(message.kind, "analyzer-ready");
      assert.equal(typeof message.pid, "number");
      assert.equal(typeof message.directory, "string");
      analyzer = message;
      assert.ok(analyzer);
      const analyzerPid = analyzer.pid;
      const analyzerClosed = once(child, "message").then((messages) => {
        analyzerHasClosed = messages[0].kind === "analyzer-closed";
        return messages;
      });
      assert.equal(child.kill(signal), true);
      const [[closed], exitCode] = await guarded(
        Promise.all([analyzerClosed, completion]),
        "analyzer and CLI close after cancellation",
      );

      assert.deepEqual(closed, { kind: "analyzer-closed", code: null, signal: "SIGTERM" });
      assert.equal(exitCode, 1);
      assert.equal(Buffer.concat(stdout).toString("utf8"), "");
      assert.equal(
        Buffer.concat(stderr).toString("utf8"),
        '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"cancelled","stage":"analyze"},"ok":false},"schemaVersion":1}\n',
      );
      assert.throws(
        () => process.kill(analyzerPid, 0),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
      );
      await assert.rejects(
        access(analyzer.directory),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
      );
    } finally {
      try {
        if (!cliClosed) {
          child.kill("SIGTERM");
          try {
            await guarded(completion, "CLI graceful cleanup", 1_000);
          } catch {
            child.kill("SIGKILL");
            await guarded(completion, "CLI forced cleanup", 1_000);
          }
        }
      } finally {
        try {
          if (analyzer !== undefined) {
            if (!analyzerHasClosed) {
              try {
                process.kill(-analyzer.pid, "SIGKILL");
              } catch {
                /* Already reclaimed. */
              }
            }
            await rm(analyzer.directory, { recursive: true, force: true });
          }
        } finally {
          await rm(temporaryDirectory, { recursive: true, force: true });
        }
      }
    }
  });
}

test("cancels a blocked diff stream and closes the one-shot CLI", {
  skip: process.platform !== "linux",
  timeout: 10_000,
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
    let output = "";
    writer.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output === "ready\n") resolveReady();
    });
  });

  try {
    await guarded(
      Promise.race([
        writerReady,
        writerCompletion.then(() => {
          throw new Error("FIFO writer closed before readiness");
        }),
        completion.then(() => {
          throw new Error("CLI closed before FIFO readiness");
        }),
      ]),
      "FIFO writer readiness",
    );
    child.kill("SIGTERM");
    const exitCode = await guarded(completion, "CLI close after diff cancellation", 1_000);

    assert.equal(exitCode, 1);
    assert.equal(
      Buffer.concat(stderr).toString("utf8"),
      '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"cancelled","stage":"start"},"ok":false},"schemaVersion":1}\n',
    );
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await guarded(completion, "CLI cleanup");
    } finally {
      try {
        if (writer.exitCode === null && writer.signalCode === null) writer.kill("SIGKILL");
        await guarded(writerCompletion, "FIFO writer cleanup");
      } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
      }
    }
  }
});
