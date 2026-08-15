import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { ParsedDiff } from "@eve-reviewer/core";

import {
  createLocalBiomeExecutor,
  loadHeadSources,
  localAnalyzerLimits,
} from "../src/local-biome.ts";

function changedPackageDiff(): ParsedDiff {
  return {
    files: [
      {
        oldPath: "package.json",
        newPath: "package.json",
        status: "modified",
        lines: [
          {
            location: { side: "new", path: "package.json", line: 1 },
            content: "{",
            changed: true,
          },
        ],
      },
    ],
  };
}

test("returns cancellation before loading head sources", async () => {
  const controller = new AbortController();
  controller.abort();
  let loadingStarts = 0;

  const result = await loadHeadSources(
    changedPackageDiff(),
    process.cwd(),
    localAnalyzerLimits,
    {
      signal: controller.signal,
      deadline: 0,
    },
    {
      async beforeSourceLoad() {
        loadingStarts += 1;
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "cancelled",
      stage: "start",
      message: "The deterministic review was cancelled before source loading started.",
    },
  });
  assert.equal(loadingStarts, 0);
});

test("returns deadline expiry before loading head sources", async () => {
  let loadingStarts = 0;

  const result = await loadHeadSources(
    changedPackageDiff(),
    process.cwd(),
    localAnalyzerLimits,
    { signal: new AbortController().signal, deadline: 0 },
    {
      async beforeSourceLoad() {
        loadingStarts += 1;
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "deadline-exceeded",
      stage: "start",
      message: "The deterministic review deadline elapsed before source loading started.",
    },
  });
  assert.equal(loadingStarts, 0);
});

test("does not wait for blocked source loading after cancellation", async () => {
  const controller = new AbortController();
  let sourceLoadingStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    sourceLoadingStarted = resolve;
  });
  const pending = loadHeadSources(
    changedPackageDiff(),
    process.cwd(),
    localAnalyzerLimits,
    { signal: controller.signal, deadline: Date.now() + 5_000 },
    {
      beforeSourceLoad: async () => {
        sourceLoadingStarted();
        await new Promise(() => undefined);
      },
    },
  );
  await started;

  controller.abort();
  const result = await Promise.race([
    pending,
    delay(500, undefined, { ref: false }).then(() => {
      throw new Error("source loading did not observe cancellation");
    }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "cancelled",
      stage: "start",
      message: "The deterministic review was cancelled during source loading.",
      cleanupIncomplete: true,
    },
  });
});

test("does not wait for blocked source loading after the absolute deadline", async () => {
  const pending = loadHeadSources(
    changedPackageDiff(),
    process.cwd(),
    localAnalyzerLimits,
    { signal: new AbortController().signal, deadline: Date.now() + 20 },
    {
      beforeSourceLoad: async () => {
        await new Promise(() => undefined);
      },
    },
  );

  const result = await Promise.race([
    pending,
    delay(500, undefined, { ref: false }).then(() => {
      throw new Error("source loading did not observe the absolute deadline");
    }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "deadline-exceeded",
      stage: "start",
      message: "The deterministic review deadline elapsed during source loading.",
      cleanupIncomplete: true,
    },
  });
});

test("counts only source-bearing files against the source file limit", async () => {
  const parsed: ParsedDiff = {
    files: Array.from({ length: 101 }, (_, index) => ({
      oldPath: `src/deleted-${index}.ts`,
      newPath: null,
      status: "deleted" as const,
      lines: [
        {
          location: { side: "old" as const, path: `src/deleted-${index}.ts`, line: 1 },
          content: "deleted();",
          changed: true,
        },
      ],
    })),
  };

  const result = await loadHeadSources(parsed, process.cwd(), localAnalyzerLimits, {
    signal: new AbortController().signal,
    deadline: Date.now() + 5_000,
  });

  assert.deepEqual(result, { ok: true, sources: [] });
});

test("returns a typed start failure when temporary resources cannot be created", async () => {
  const executeAnalyzer = createLocalBiomeExecutor({
    async createTemporaryDirectory() {
      throw new Error("injected temporary directory failure");
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 5_000,
      limits: localAnalyzerLimits,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "start",
    version: "2.5.8",
    message: "temporary resources unavailable",
  });
});

test("bounds cancellation while temporary resource creation is blocked", async () => {
  const controller = new AbortController();
  let creationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    creationStarted = resolve;
  });
  const executeAnalyzer = createLocalBiomeExecutor({
    async createTemporaryDirectory() {
      creationStarted();
      return await new Promise<string>(() => undefined);
    },
  });
  const pending = executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: controller.signal,
      deadline: Date.now() + 5_000,
      limits: localAnalyzerLimits,
    },
  );
  await started;

  controller.abort();
  const result = await Promise.race([
    pending,
    delay(800, undefined, { ref: false }).then(() => {
      throw new Error("temporary resource creation did not observe cancellation");
    }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    failure: "cancelled",
    version: "2.5.8",
    cleanupIncomplete: true,
  });
});

test("bounds temporary resource creation at the absolute deadline", async () => {
  const executeAnalyzer = createLocalBiomeExecutor({
    async createTemporaryDirectory() {
      return await new Promise<string>(() => undefined);
    },
  });
  const pending = executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 20,
      limits: localAnalyzerLimits,
    },
  );

  const result = await Promise.race([
    pending,
    delay(800, undefined, { ref: false }).then(() => {
      throw new Error("temporary resource creation did not observe the absolute deadline");
    }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    failure: "deadline",
    version: "2.5.8",
    cleanupIncomplete: true,
  });
});

test("captures cancellation that arrives while analyzer resources are being prepared", {
  skip: process.platform !== "linux",
}, async () => {
  const controller = new AbortController();
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    temporaryDirectoryCreated(path) {
      temporaryDirectory = path;
      controller.abort();
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: controller.signal,
      deadline: Date.now() + 5_000,
      limits: localAnalyzerLimits,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "cancelled",
    version: "2.5.8",
  });
  assert.notEqual(temporaryDirectory, undefined);
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("does not wait for blocked snapshot preparation after cancellation", async () => {
  const controller = new AbortController();
  let temporaryDirectory: string | undefined;
  let preparationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    preparationStarted = resolve;
  });
  const executeAnalyzer = createLocalBiomeExecutor({
    temporaryDirectoryCreated(path) {
      temporaryDirectory = path;
    },
    async beforeSnapshotPreparation() {
      preparationStarted();
      await new Promise(() => undefined);
    },
  });
  const pending = executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: controller.signal,
      deadline: Date.now() + 5_000,
      limits: localAnalyzerLimits,
    },
  );
  await Promise.race([
    started,
    delay(500, undefined, { ref: false }).then(() => {
      throw new Error("snapshot preparation hook did not start");
    }),
  ]);

  controller.abort();
  const result = await Promise.race([
    pending,
    delay(800, undefined, { ref: false }).then(() => {
      throw new Error("snapshot preparation did not observe cancellation");
    }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    failure: "cancelled",
    version: "2.5.8",
    cleanupIncomplete: true,
  });
  assert.notEqual(temporaryDirectory, undefined);
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("bounds blocked snapshot preparation at the absolute deadline", async () => {
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    temporaryDirectoryCreated(path) {
      temporaryDirectory = path;
    },
    async beforeSnapshotPreparation() {
      await new Promise(() => undefined);
    },
  });
  const pending = executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 20,
      limits: localAnalyzerLimits,
    },
  );

  const result = await Promise.race([
    pending,
    delay(800, undefined, { ref: false }).then(() => {
      throw new Error("snapshot preparation did not observe the absolute deadline");
    }),
  ]);

  assert.deepEqual(result, {
    ok: false,
    failure: "deadline",
    version: "2.5.8",
    cleanupIncomplete: true,
  });
  assert.notEqual(temporaryDirectory, undefined);
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("cancels a running Linux analyzer process group and removes its temporary directory", {
  skip: process.platform !== "linux",
}, async () => {
  const controller = new AbortController();
  let processId: number | undefined;
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      processId = event.pid;
      temporaryDirectory = event.temporaryDirectory;
      controller.abort();
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "eval(userInput);\n" }],
    },
    {
      signal: controller.signal,
      deadline: Date.now() + 5_000,
      limits: localAnalyzerLimits,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "cancelled",
    version: "2.5.8",
  });
  assert.notEqual(processId, undefined);
  assert.notEqual(temporaryDirectory, undefined);
  assert.throws(
    () => process.kill(processId as number, 0),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
  );
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("forces a stopped Linux analyzer process group down after the deadline and cleans up", {
  skip: process.platform !== "linux",
}, async () => {
  let processId: number | undefined;
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      processId = event.pid;
      temporaryDirectory = event.temporaryDirectory;
      process.kill(-event.pid, "SIGSTOP");
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "eval(userInput);\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 20,
      limits: { ...localAnalyzerLimits, terminationGraceMilliseconds: 20 },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "deadline",
    version: "2.5.8",
  });
  assert.notEqual(processId, undefined);
  assert.notEqual(temporaryDirectory, undefined);
  assert.throws(
    () => process.kill(processId as number, 0),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
  );
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("terminates the analyzer when stderr exceeds the caller-tightened limit", {
  skip: process.platform !== "linux",
}, async () => {
  let processId: number | undefined;
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      processId = event.pid;
      temporaryDirectory = event.temporaryDirectory;
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "eval(userInput);\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 5_000,
      limits: { ...localAnalyzerLimits, maximumStderrBytes: 1 },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "limit",
    resource: "stderr",
    version: "2.5.8",
  });
  assert.notEqual(processId, undefined);
  assert.notEqual(temporaryDirectory, undefined);
  assert.throws(
    () => process.kill(processId as number, 0),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
  );
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("rejects an analyzer report that exceeds the caller-tightened limit", {
  skip: process.platform !== "linux",
}, async () => {
  let processId: number | undefined;
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      processId = event.pid;
      temporaryDirectory = event.temporaryDirectory;
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 5_000,
      limits: { ...localAnalyzerLimits, maximumReportBytes: 1 },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "limit",
    resource: "report",
    version: "2.5.8",
  });
  assert.notEqual(processId, undefined);
  assert.notEqual(temporaryDirectory, undefined);
  assert.throws(
    () => process.kill(processId as number, 0),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ESRCH",
  );
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("returns cleanup failure when successful analysis cannot remove temporary resources", {
  skip: process.platform !== "linux",
}, async () => {
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      temporaryDirectory = event.temporaryDirectory;
    },
    async removeTemporaryDirectory() {
      throw new Error("injected cleanup failure");
    },
  });

  try {
    const result = await executeAnalyzer(
      {
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
        sources: [{ path: "src/example.ts", content: "safe();\n" }],
      },
      {
        signal: new AbortController().signal,
        deadline: Date.now() + 5_000,
        limits: localAnalyzerLimits,
      },
    );

    assert.deepEqual(result, {
      ok: false,
      failure: "cleanup",
      version: "2.5.8",
    });
  } finally {
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

test("preserves cancellation that arrives while successful analysis is cleaning up", {
  skip: process.platform !== "linux",
}, async () => {
  const controller = new AbortController();
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      temporaryDirectory = event.temporaryDirectory;
    },
    async removeTemporaryDirectory(path) {
      controller.abort();
      await rm(path, { recursive: true, force: true });
    },
  });

  const result = await executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: controller.signal,
      deadline: Date.now() + 5_000,
      limits: localAnalyzerLimits,
    },
  );

  assert.deepEqual(result, {
    ok: false,
    failure: "cancelled",
    version: "2.5.8",
  });
  assert.notEqual(temporaryDirectory, undefined);
  await assert.rejects(
    access(temporaryDirectory as string),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("does not wait for blocked report reading after cancellation", {
  skip: process.platform !== "linux",
}, async () => {
  const controller = new AbortController();
  let temporaryDirectory: string | undefined;
  let releaseReportRead!: () => void;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      temporaryDirectory = event.temporaryDirectory;
    },
    async beforeReportRead() {
      controller.abort();
      await new Promise<void>((resolve) => {
        releaseReportRead = resolve;
      });
    },
  });
  const pending = executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: controller.signal,
      deadline: Date.now() + 5_000,
      limits: { ...localAnalyzerLimits, terminationGraceMilliseconds: 20 },
    },
  );

  try {
    const result = await Promise.race([pending, delay(200).then(() => "timed-out" as const)]);
    assert.deepEqual(result, {
      ok: false,
      failure: "cancelled",
      version: "2.5.8",
      cleanupIncomplete: true,
    });
    assert.notEqual(temporaryDirectory, undefined);
    await assert.rejects(
      access(temporaryDirectory as string),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT",
    );
  } finally {
    releaseReportRead();
    await pending;
  }
});

test("bounds blocked cleanup after the absolute deadline", {
  skip: process.platform !== "linux",
}, async () => {
  let temporaryDirectory: string | undefined;
  let releaseCleanup!: () => void;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      temporaryDirectory = event.temporaryDirectory;
    },
    async removeTemporaryDirectory() {
      await new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
    },
  });
  const pending = executeAnalyzer(
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [{ path: "src/example.ts", content: "safe();\n" }],
    },
    {
      signal: new AbortController().signal,
      deadline: Date.now() + 100,
      limits: { ...localAnalyzerLimits, terminationGraceMilliseconds: 20 },
    },
  );

  try {
    const result = await Promise.race([pending, delay(300).then(() => "timed-out" as const)]);
    assert.deepEqual(result, {
      ok: false,
      failure: "deadline",
      version: "2.5.8",
      cleanupIncomplete: true,
    });
    assert.notEqual(temporaryDirectory, undefined);
  } finally {
    releaseCleanup();
    await pending;
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

test("preserves cancellation when temporary resource cleanup also fails", {
  skip: process.platform !== "linux",
}, async () => {
  const controller = new AbortController();
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      temporaryDirectory = event.temporaryDirectory;
      controller.abort();
    },
    async removeTemporaryDirectory() {
      throw new Error("injected cleanup failure");
    },
  });

  try {
    const result = await executeAnalyzer(
      {
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
        sources: [{ path: "src/example.ts", content: "safe();\n" }],
      },
      {
        signal: controller.signal,
        deadline: Date.now() + 5_000,
        limits: localAnalyzerLimits,
      },
    );

    assert.deepEqual(result, {
      ok: false,
      failure: "cancelled",
      version: "2.5.8",
      cleanupIncomplete: true,
    });
  } finally {
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

test("preserves an analyzer limit failure when temporary resource cleanup also fails", {
  skip: process.platform !== "linux",
}, async () => {
  let temporaryDirectory: string | undefined;
  const executeAnalyzer = createLocalBiomeExecutor({
    processStarted(event) {
      temporaryDirectory = event.temporaryDirectory;
    },
    async removeTemporaryDirectory() {
      throw new Error("injected cleanup failure");
    },
  });

  try {
    const result = await executeAnalyzer(
      {
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
        sources: [{ path: "src/example.ts", content: "eval(userInput);\n" }],
      },
      {
        signal: new AbortController().signal,
        deadline: Date.now() + 5_000,
        limits: { ...localAnalyzerLimits, maximumStderrBytes: 1 },
      },
    );

    assert.deepEqual(result, {
      ok: false,
      failure: "limit",
      resource: "stderr",
      version: "2.5.8",
      cleanupIncomplete: true,
    });
  } finally {
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});
