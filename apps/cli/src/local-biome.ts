import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  AnalyzerContext,
  AnalyzerExecutionInput,
  AnalyzerExecutionResult,
  ExecuteAnalyzer,
  ParsedDiff,
  SourceSnapshotFile,
} from "@eve-reviewer/core";

import { readBoundedTextFile } from "./bounded-file.ts";

const require = createRequire(import.meta.url);
const biomeEntryPoint = require.resolve("@biomejs/biome/bin/biome");
const biomeRequire = createRequire(biomeEntryPoint);
const biomeVersion = (require("@biomejs/biome/package.json") as { version: string }).version;

export const localAnalyzerLimits = {
  maximumSourceFiles: 100,
  maximumSourceFileBytes: 1_000_000,
  maximumSnapshotBytes: 5_000_000,
  maximumStdoutBytes: 1_000_000,
  maximumStderrBytes: 1_000_000,
  maximumReportBytes: 10_000_000,
  terminationGraceMilliseconds: 250,
} as const;

export type LoadedHeadSources =
  | { ok: true; sources: SourceSnapshotFile[] }
  | { ok: false; error: { code: "invalid-source"; message: string } }
  | {
      ok: false;
      error: {
        code: "cancelled" | "deadline-exceeded";
        stage: "start";
        message: string;
        cleanupIncomplete?: true;
      };
    };

type LocalOperationContext = Pick<AnalyzerContext, "signal" | "deadline">;
type LocalCancellationReason = { failure: "cancelled" | "deadline" };
type LocalTerminalReason =
  | LocalCancellationReason
  | { failure: "limit"; resource: "stdout" | "stderr" };

function createCancellationTracker(context: LocalOperationContext): {
  terminal: Promise<LocalCancellationReason>;
  stop(): void;
} {
  let terminalReason: LocalCancellationReason | undefined;
  let resolveTerminal!: (reason: LocalCancellationReason) => void;
  const terminal = new Promise<LocalCancellationReason>((resolve) => {
    resolveTerminal = resolve;
  });
  const claim = (reason: LocalCancellationReason): void => {
    if (terminalReason === undefined) {
      terminalReason = reason;
      resolveTerminal(reason);
    }
  };
  const cancel = (): void => claim({ failure: "cancelled" });
  let deadlineTimer: NodeJS.Timeout | undefined;
  if (context.signal.aborted) {
    cancel();
  } else {
    context.signal.addEventListener("abort", cancel, { once: true });
    if (context.signal.aborted) {
      cancel();
    } else if (context.deadline <= Date.now()) {
      claim({ failure: "deadline" });
    } else {
      deadlineTimer = setTimeout(
        () => claim({ failure: "deadline" }),
        context.deadline - Date.now(),
      );
    }
  }
  return {
    terminal,
    stop() {
      context.signal.removeEventListener("abort", cancel);
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
      }
    },
  };
}

function tightenedLimit(requested: number, maximum: number): number {
  if (Number.isNaN(requested) || requested <= 0) {
    return 0;
  }
  if (!Number.isFinite(requested)) {
    return maximum;
  }
  return Math.min(Math.floor(requested), maximum);
}

function tightenedLocalLimits(requested: AnalyzerContext["limits"]): AnalyzerContext["limits"] {
  return {
    maximumSourceFiles: tightenedLimit(
      requested.maximumSourceFiles,
      localAnalyzerLimits.maximumSourceFiles,
    ),
    maximumSourceFileBytes: tightenedLimit(
      requested.maximumSourceFileBytes,
      localAnalyzerLimits.maximumSourceFileBytes,
    ),
    maximumSnapshotBytes: tightenedLimit(
      requested.maximumSnapshotBytes,
      localAnalyzerLimits.maximumSnapshotBytes,
    ),
    maximumStdoutBytes: tightenedLimit(
      requested.maximumStdoutBytes,
      localAnalyzerLimits.maximumStdoutBytes,
    ),
    maximumStderrBytes: tightenedLimit(
      requested.maximumStderrBytes,
      localAnalyzerLimits.maximumStderrBytes,
    ),
    maximumReportBytes: tightenedLimit(
      requested.maximumReportBytes,
      localAnalyzerLimits.maximumReportBytes,
    ),
    terminationGraceMilliseconds: tightenedLimit(
      requested.terminationGraceMilliseconds,
      localAnalyzerLimits.terminationGraceMilliseconds,
    ),
  };
}

function isMuslLinux(): boolean {
  const report = process.report.getReport() as {
    header?: { glibcVersionRuntime?: unknown };
  };
  return process.platform === "linux" && report.header?.glibcVersionRuntime === undefined;
}

function resolveBiomeBinary(): string | undefined {
  const linuxSuffix = isMuslLinux() ? "-musl" : "";
  const packages: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> = {
    linux: {
      x64: `@biomejs/cli-linux-x64${linuxSuffix}/biome`,
      arm64: `@biomejs/cli-linux-arm64${linuxSuffix}/biome`,
    },
    darwin: {
      x64: "@biomejs/cli-darwin-x64/biome",
      arm64: "@biomejs/cli-darwin-arm64/biome",
    },
    win32: {
      x64: "@biomejs/cli-win32-x64/biome.exe",
      arm64: "@biomejs/cli-win32-arm64/biome.exe",
    },
  };
  const packageName = packages[process.platform]?.[process.arch];
  if (packageName === undefined) {
    return undefined;
  }
  try {
    return biomeRequire.resolve(packageName);
  } catch {
    return undefined;
  }
}

function resolveInside(root: string, path: string): string | undefined {
  if (isAbsolute(path)) {
    return undefined;
  }
  const candidate = resolve(root, path);
  const relativePath = relative(root, candidate);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    return undefined;
  }
  return candidate;
}

function disableSourceSuppressions(source: string): string {
  return source.replaceAll(/biome-ignore(?=-|\s)/g, "biome_ignore");
}

function signalAnalyzerProcess(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "linux" && child.pid !== undefined) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    // The process may have exited between the terminal event and the signal.
  }
}

async function closesWithin(completion: Promise<unknown>, milliseconds: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const closed = await Promise.race([
    completion.then(() => true),
    new Promise<false>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), milliseconds);
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return closed;
}

async function cleanupSucceedsWithin(
  cleanup: Promise<boolean>,
  milliseconds: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const succeeded = await Promise.race([
    cleanup,
    new Promise<false>((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout(false), milliseconds);
    }),
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }
  return succeeded;
}

async function terminateAnalyzerProcess(
  child: ReturnType<typeof spawn>,
  completion: Promise<unknown>,
  graceMilliseconds: number,
): Promise<boolean> {
  signalAnalyzerProcess(child, "SIGTERM");
  if (await closesWithin(completion, graceMilliseconds)) {
    return true;
  }
  signalAnalyzerProcess(child, "SIGKILL");
  return await closesWithin(completion, graceMilliseconds);
}

function hasChangedHeadLine(parsed: ParsedDiff, path: string): boolean {
  return parsed.files.some((file) =>
    file.lines.some(
      (line) => line.changed && line.location.side === "new" && line.location.path === path,
    ),
  );
}

async function readHeadSources(
  parsed: ParsedDiff,
  sourceRoot: string,
  requestedLimits: AnalyzerContext["limits"],
  context: LocalOperationContext,
): Promise<LoadedHeadSources> {
  const limits = tightenedLocalLimits(requestedLimits);
  let sourceRootPath: string;
  try {
    sourceRootPath = await realpath(sourceRoot);
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid-source",
        message: "Unable to read the complete source snapshot.",
      },
    };
  }

  const sources: SourceSnapshotFile[] = [];
  let aggregateBytes = 0;
  for (const file of parsed.files) {
    const path = file.newPath;
    if (path === null || !hasChangedHeadLine(parsed, path)) {
      continue;
    }
    if (sources.length >= limits.maximumSourceFiles) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `Source snapshot exceeds the ${limits.maximumSourceFiles}-file limit.`,
        },
      };
    }
    const resolvedPath = resolveInside(sourceRootPath, path);
    if (resolvedPath === undefined) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `Source path is outside the source root: ${path}.`,
        },
      };
    }
    let realSourcePath: string;
    try {
      realSourcePath = await realpath(resolvedPath);
    } catch {
      return {
        ok: false,
        error: { code: "invalid-source", message: `Unable to read source file: ${path}.` },
      };
    }
    const relativeRealPath = relative(sourceRootPath, realSourcePath);
    if (relativeRealPath === ".." || relativeRealPath.startsWith(`..${sep}`)) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `Source path is outside the source root: ${path}.`,
        },
      };
    }
    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(realSourcePath);
    } catch {
      return {
        ok: false,
        error: { code: "invalid-source", message: `Unable to read source file: ${path}.` },
      };
    }
    if (!sourceStat.isFile()) {
      return {
        ok: false,
        error: { code: "invalid-source", message: `Source path is not a regular file: ${path}.` },
      };
    }
    if (sourceStat.size > limits.maximumSourceFileBytes) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `Source file exceeds the ${limits.maximumSourceFileBytes}-byte limit: ${path}.`,
        },
      };
    }
    const source = await readBoundedTextFile(realSourcePath, limits.maximumSourceFileBytes, {
      signal: context.signal,
      deadline: context.deadline,
      graceMilliseconds: limits.terminationGraceMilliseconds,
    });
    if (!source.ok) {
      if (source.failure === "cancelled" || source.failure === "deadline") {
        return source.failure === "cancelled"
          ? {
              ok: false,
              error: {
                code: "cancelled",
                stage: "start",
                message: "The deterministic review was cancelled during source loading.",
                ...(source.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
              },
            }
          : {
              ok: false,
              error: {
                code: "deadline-exceeded",
                stage: "start",
                message: "The deterministic review deadline elapsed during source loading.",
                ...(source.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
              },
            };
      }
      return {
        ok: false,
        error:
          source.failure === "limit"
            ? {
                code: "invalid-source",
                message: `Source file exceeds the ${limits.maximumSourceFileBytes}-byte limit: ${path}.`,
              }
            : { code: "invalid-source", message: `Unable to read source file: ${path}.` },
      };
    }
    aggregateBytes += source.bytes;
    if (aggregateBytes > limits.maximumSnapshotBytes) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `Source snapshot exceeds the ${limits.maximumSnapshotBytes}-byte aggregate limit.`,
        },
      };
    }
    sources.push({ path, content: source.text });
  }
  return { ok: true, sources };
}

export interface LoadHeadSourcesOptions {
  beforeSourceLoad?(): Promise<void>;
}

export async function loadHeadSources(
  parsed: ParsedDiff,
  sourceRoot: string,
  requestedLimits: AnalyzerContext["limits"],
  context: LocalOperationContext,
  options: LoadHeadSourcesOptions = {},
): Promise<LoadedHeadSources> {
  if (context.signal.aborted) {
    return {
      ok: false,
      error: {
        code: "cancelled",
        stage: "start",
        message: "The deterministic review was cancelled before source loading started.",
      },
    };
  }
  if (context.deadline <= Date.now()) {
    return {
      ok: false,
      error: {
        code: "deadline-exceeded",
        stage: "start",
        message: "The deterministic review deadline elapsed before source loading started.",
      },
    };
  }
  const tracker = createCancellationTracker(context);
  const loading = (async () => {
    await options.beforeSourceLoad?.();
    return await readHeadSources(parsed, sourceRoot, requestedLimits, context);
  })();
  const first = await Promise.race([
    loading.then((result) => ({ kind: "loaded" as const, result })),
    tracker.terminal.then((reason) => ({ kind: "terminal" as const, reason })),
  ]);
  tracker.stop();
  if (first.kind === "loaded") {
    return first.result;
  }
  const loadingStopped = await closesWithin(
    loading.catch(() => undefined),
    tightenedLocalLimits(requestedLimits).terminationGraceMilliseconds,
  );
  return first.reason.failure === "cancelled"
    ? {
        ok: false,
        error: {
          code: "cancelled",
          stage: "start",
          message: "The deterministic review was cancelled during source loading.",
          ...(loadingStopped ? {} : { cleanupIncomplete: true as const }),
        },
      }
    : {
        ok: false,
        error: {
          code: "deadline-exceeded",
          stage: "start",
          message: "The deterministic review deadline elapsed during source loading.",
          ...(loadingStopped ? {} : { cleanupIncomplete: true as const }),
        },
      };
}

export interface LocalBiomeExecutorOptions {
  createTemporaryDirectory?(): Promise<string>;
  temporaryDirectoryCreated?(path: string): void;
  beforeSnapshotPreparation?(): Promise<void>;
  processStarted?(event: { pid: number; temporaryDirectory: string }): void;
  beforeReportRead?(): Promise<void>;
  removeTemporaryDirectory?(path: string): Promise<void>;
}

export function createLocalBiomeExecutor(options: LocalBiomeExecutorOptions = {}): ExecuteAnalyzer {
  return async function executeBiome(
    input: AnalyzerExecutionInput,
    context: AnalyzerContext,
  ): Promise<AnalyzerExecutionResult> {
    const limits = tightenedLocalLimits(context.limits);
    if (context.signal.aborted) {
      return { ok: false, failure: "cancelled", version: biomeVersion };
    }
    if (context.deadline <= Date.now()) {
      return { ok: false, failure: "deadline", version: biomeVersion };
    }
    if (input.sources.length === 0) {
      return {
        ok: true,
        version: biomeVersion,
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      };
    }

    const biomeBinary = resolveBiomeBinary();
    if (biomeBinary === undefined) {
      return { ok: false, failure: "start", version: biomeVersion, message: "unsupported" };
    }

    const cleanupDirectory = async (path: string): Promise<boolean> => {
      try {
        if (options.removeTemporaryDirectory === undefined) {
          await rm(path, { recursive: true, force: true });
        } else {
          await options.removeTemporaryDirectory(path);
        }
        return true;
      } catch {
        return false;
      }
    };
    const preparationTracker = createCancellationTracker(context);
    const temporaryDirectory = (async () =>
      options.createTemporaryDirectory === undefined
        ? await mkdtemp(join(tmpdir(), "eve-biome-review-"))
        : await options.createTemporaryDirectory())();
    const temporaryDirectoryFirst = await Promise.race([
      temporaryDirectory
        .then((path) => ({ kind: "created" as const, path }))
        .catch(() => ({
          kind: "failed" as const,
        })),
      preparationTracker.terminal.then((reason) => ({ kind: "terminal" as const, reason })),
    ]);
    if (temporaryDirectoryFirst.kind === "terminal") {
      preparationTracker.stop();
      const cleaned = await cleanupSucceedsWithin(
        temporaryDirectory.then(cleanupDirectory).catch(() => true),
        limits.terminationGraceMilliseconds,
      );
      return {
        ok: false,
        ...temporaryDirectoryFirst.reason,
        version: biomeVersion,
        ...(cleaned ? {} : { cleanupIncomplete: true as const }),
      };
    }
    if (temporaryDirectoryFirst.kind === "failed") {
      preparationTracker.stop();
      return {
        ok: false,
        failure: "start",
        version: biomeVersion,
        message: "temporary resources unavailable",
      };
    }
    const reportDirectory = temporaryDirectoryFirst.path;
    options.temporaryDirectoryCreated?.(reportDirectory);
    const snapshotDirectory = join(reportDirectory, "snapshot");
    const reportPath = join(reportDirectory, "report.sarif");
    const configPath = join(reportDirectory, "biome.json");
    const analyzerPaths: string[] = [];
    const artifacts: Array<{ uri: string; path: string }> = [];

    let outcome: AnalyzerExecutionResult;
    try {
      outcome = await (async (): Promise<AnalyzerExecutionResult> => {
        const preparationAbort = new AbortController();
        const preparation = (async (): Promise<AnalyzerExecutionResult | undefined> => {
          await options.beforeSnapshotPreparation?.();
          for (const source of input.sources) {
            const analyzerPath = resolveInside(snapshotDirectory, source.path);
            if (analyzerPath === undefined) {
              return {
                ok: false,
                failure: "execution",
                version: biomeVersion,
                exitCode: null,
                message: "invalid source path",
              };
            }
            await mkdir(dirname(analyzerPath), { recursive: true });
            await writeFile(analyzerPath, disableSourceSuppressions(source.content), {
              encoding: "utf8",
              signal: preparationAbort.signal,
            });
            const realAnalyzerPath = await realpath(analyzerPath);
            analyzerPaths.push(realAnalyzerPath);
            artifacts.push({ uri: realAnalyzerPath, path: source.path });
          }
          await writeFile(
            configPath,
            JSON.stringify({
              vcs: { enabled: false },
              files: { ignoreUnknown: true, maxSize: localAnalyzerLimits.maximumSourceFileBytes },
              linter: { enabled: true },
            }),
            { encoding: "utf8", signal: preparationAbort.signal },
          );
          return undefined;
        })();
        const preparationFirst = await Promise.race([
          preparation.then(
            (result) => ({ kind: "prepared" as const, result }),
            () => ({ kind: "failed" as const }),
          ),
          preparationTracker.terminal.then((reason) => ({ kind: "terminal" as const, reason })),
        ]);
        preparationTracker.stop();
        if (preparationFirst.kind === "failed") {
          throw new Error("snapshot preparation failed");
        }
        if (preparationFirst.kind === "terminal") {
          preparationAbort.abort();
          const preparationStopped = await closesWithin(
            preparation.catch(() => undefined),
            limits.terminationGraceMilliseconds,
          );
          return {
            ok: false,
            ...preparationFirst.reason,
            version: biomeVersion,
            ...(preparationStopped ? {} : { cleanupIncomplete: true as const }),
          };
        }
        if (preparationFirst.result !== undefined) {
          return preparationFirst.result;
        }

        if (context.signal.aborted) {
          return { ok: false, failure: "cancelled", version: biomeVersion };
        }
        if (context.deadline <= Date.now()) {
          return { ok: false, failure: "deadline", version: biomeVersion };
        }

        const child = spawn(
          biomeBinary,
          [
            "lint",
            "--only=lint/security/noGlobalEval",
            `--config-path=${configPath}`,
            "--reporter=sarif",
            `--reporter-file=${reportPath}`,
            "--max-diagnostics=none",
            "--colors=off",
            ...analyzerPaths,
          ],
          {
            cwd: snapshotDirectory,
            detached: process.platform === "linux",
            env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", NO_COLOR: "1" },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          },
        );
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const completion = new Promise<
          { kind: "close"; exitCode: number | null } | { kind: "error"; message: string }
        >((resolveCompletion) => {
          child.once("error", (error) =>
            resolveCompletion({ kind: "error", message: error.message }),
          );
          child.once("close", (exitCode) => resolveCompletion({ kind: "close", exitCode }));
        });
        let limitReason: Extract<LocalTerminalReason, { failure: "limit" }> | undefined;
        let resolveLimit!: (reason: Extract<LocalTerminalReason, { failure: "limit" }>) => void;
        const limit = new Promise<Extract<LocalTerminalReason, { failure: "limit" }>>((resolve) => {
          resolveLimit = resolve;
        });
        const claimLimit = (reason: Extract<LocalTerminalReason, { failure: "limit" }>): void => {
          if (limitReason === undefined) {
            limitReason = reason;
            resolveLimit(reason);
          }
        };
        let stdoutBytes = 0;
        let stderrBytes = 0;
        child.stdout.on("data", (chunk: Buffer) => {
          stdoutBytes += chunk.byteLength;
          if (stdoutBytes > limits.maximumStdoutBytes) {
            claimLimit({ failure: "limit", resource: "stdout" });
          } else {
            stdoutChunks.push(chunk);
          }
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderrBytes += chunk.byteLength;
          if (stderrBytes > limits.maximumStderrBytes) {
            claimLimit({ failure: "limit", resource: "stderr" });
          } else {
            stderrChunks.push(chunk);
          }
        });
        const processTracker = createCancellationTracker(context);
        if (child.pid !== undefined) {
          options.processStarted?.({ pid: child.pid, temporaryDirectory: reportDirectory });
        }
        const first = await Promise.race([
          completion.then((completed) => ({ kind: "completed" as const, completed })),
          processTracker.terminal.then((reason) => ({ kind: "terminal" as const, reason })),
          limit.then((reason) => ({ kind: "terminal" as const, reason })),
        ]);
        processTracker.stop();
        if (first.kind === "terminal") {
          const terminated = await terminateAnalyzerProcess(
            child,
            completion,
            limits.terminationGraceMilliseconds,
          );
          return {
            ok: false,
            ...first.reason,
            version: biomeVersion,
            ...(terminated ? {} : { cleanupIncomplete: true as const }),
          };
        }
        const completed = first.completed;
        if (completed.kind === "error") {
          return { ok: false, failure: "start", version: biomeVersion, message: completed.message };
        }
        const exitCode = completed.exitCode;
        if (exitCode !== 0 && exitCode !== 1) {
          return {
            ok: false,
            failure: "execution",
            version: biomeVersion,
            exitCode,
            message: "abnormal exit",
          };
        }
        const report = await readBoundedTextFile(
          reportPath,
          limits.maximumReportBytes,
          {
            signal: context.signal,
            deadline: context.deadline,
            graceMilliseconds: limits.terminationGraceMilliseconds,
          },
          options.beforeReportRead === undefined ? {} : { beforeRead: options.beforeReportRead },
        );
        if (!report.ok) {
          if (report.failure === "limit") {
            return { ok: false, failure: "limit", resource: "report", version: biomeVersion };
          }
          if (report.failure === "cancelled" || report.failure === "deadline") {
            return {
              ok: false,
              failure: report.failure,
              version: biomeVersion,
              ...(report.cleanupIncomplete ? { cleanupIncomplete: true as const } : {}),
            };
          }
          return {
            ok: false,
            failure: "execution",
            version: biomeVersion,
            exitCode,
            message: "missing report",
          };
        }
        return {
          ok: true,
          version: biomeVersion,
          exitCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          artifacts,
          report: report.text,
        };
      })();
    } catch {
      outcome = {
        ok: false,
        failure: "execution",
        version: biomeVersion,
        exitCode: null,
        message: "adapter failure",
      };
    }
    const cleanup = async (): Promise<boolean> => await cleanupDirectory(reportDirectory);

    if (!outcome.ok) {
      const cleaned = await cleanupSucceedsWithin(cleanup(), limits.terminationGraceMilliseconds);
      if (!cleaned && outcome.failure !== "cleanup") {
        return { ...outcome, cleanupIncomplete: true };
      }
      return outcome;
    }

    const cleanupTracker = createCancellationTracker(context);
    const cleanupPromise = cleanup();
    const cleanupFirst = await Promise.race([
      cleanupPromise.then((succeeded) => ({ kind: "cleanup" as const, succeeded })),
      cleanupTracker.terminal.then((reason) => ({ kind: "terminal" as const, reason })),
    ]);
    cleanupTracker.stop();
    if (cleanupFirst.kind === "cleanup") {
      return cleanupFirst.succeeded
        ? outcome
        : { ok: false, failure: "cleanup", version: biomeVersion };
    }
    const cleaned = await cleanupSucceedsWithin(
      cleanupPromise,
      limits.terminationGraceMilliseconds,
    );
    return {
      ok: false,
      ...cleanupFirst.reason,
      version: biomeVersion,
      ...(cleaned ? {} : { cleanupIncomplete: true as const }),
    };
  };
}

export const executeLocalBiome: ExecuteAnalyzer = createLocalBiomeExecutor();
