#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AnalyzerOutcomeEnvelope,
  createReviewUseCase,
  type ReviewResultEnvelope,
} from "@eve-reviewer/core";

import { type EvaluationResultEnvelope, evaluationV1, type ReplayTarget } from "./index.ts";

const usage = "Usage: pnpm evaluation:compare";
const deadlineMilliseconds = 10_000;
const caseDirectory = fileURLToPath(new URL("../cases/v1/", import.meta.url));
const analyzerLimits = {
  maximumSourceFiles: 100,
  maximumSourceFileBytes: 1_000_000,
  maximumSnapshotBytes: 5_000_000,
  maximumStdoutBytes: 1_000_000,
  maximumStderrBytes: 1_000_000,
  maximumReportBytes: 5_000_000,
  terminationGraceMilliseconds: 100,
};
const unrestrictedCallerLimits = {
  maximumDatasetBytes: Number.MAX_SAFE_INTEGER,
  maximumCases: Number.MAX_SAFE_INTEGER,
  maximumProtectedFacts: Number.MAX_SAFE_INTEGER,
  maximumFindings: Number.MAX_SAFE_INTEGER,
  maximumResultBytes: Number.MAX_SAFE_INTEGER,
  maximumIssues: Number.MAX_SAFE_INTEGER,
  maximumIssueValueCharacters: Number.MAX_SAFE_INTEGER,
};

type TerminalPayload = Extract<EvaluationResultEnvelope["payload"], { ok: false }>;

function terminalResult(error: TerminalPayload["error"]): EvaluationResultEnvelope {
  return {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: { ok: false, error },
  };
}

function stoppedResult(
  signal: AbortSignal,
  deadline: number,
  clock: () => number,
): EvaluationResultEnvelope | undefined {
  if (signal.aborted) {
    return terminalResult({ code: "cancelled" });
  }
  if (clock() >= deadline) {
    return terminalResult({ code: "deadline-exceeded" });
  }
  return undefined;
}

async function loadCases(
  signal: AbortSignal,
  deadline: number,
  clock: () => number,
): Promise<{ ok: true; cases: unknown[] } | { ok: false; result: EvaluationResultEnvelope }> {
  const stoppedBeforeRead = stoppedResult(signal, deadline, clock);
  if (stoppedBeforeRead !== undefined) {
    return { ok: false, result: stoppedBeforeRead };
  }
  const entries = (await readdir(caseDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  if (entries.length > 100) {
    return {
      ok: false,
      result: terminalResult({
        code: "limit-exceeded",
        issues: [
          { path: "/limits/maximumCases", code: "exceeded", expected: 100, actual: entries.length },
        ],
      }),
    };
  }
  const cases: unknown[] = [];
  let bytes = 0;
  for (const entry of entries) {
    const stoppedBeforeFile = stoppedResult(signal, deadline, clock);
    if (stoppedBeforeFile !== undefined) {
      return { ok: false, result: stoppedBeforeFile };
    }
    const path = join(caseDirectory, entry.name);
    const metadata = await stat(path);
    bytes += metadata.size;
    if (bytes > 12_000_000) {
      return {
        ok: false,
        result: terminalResult({
          code: "limit-exceeded",
          issues: [
            {
              path: "/limits/maximumDatasetBytes",
              code: "exceeded",
              expected: 12_000_000,
              actual: bytes,
            },
          ],
        }),
      };
    }
    const stoppedAfterStat = stoppedResult(signal, deadline, clock);
    if (stoppedAfterStat !== undefined) {
      return { ok: false, result: stoppedAfterStat };
    }
    let text: string;
    try {
      text = await readFile(path, { encoding: "utf8", signal });
    } catch {
      const stoppedAfterRead = stoppedResult(signal, deadline, clock);
      return {
        ok: false,
        result:
          stoppedAfterRead ??
          terminalResult({
            code: "invalid-dataset",
            issues: [{ path: `/cases/${entry.name}`, code: "unreadable" }],
          }),
      };
    }
    const actualBytes = new TextEncoder().encode(text).byteLength;
    bytes += actualBytes - metadata.size;
    if (bytes > 12_000_000) {
      return {
        ok: false,
        result: terminalResult({
          code: "limit-exceeded",
          issues: [
            {
              path: "/limits/maximumDatasetBytes",
              code: "exceeded",
              expected: 12_000_000,
              actual: bytes,
            },
          ],
        }),
      };
    }
    const stoppedAfterFile = stoppedResult(signal, deadline, clock);
    if (stoppedAfterFile !== undefined) {
      return { ok: false, result: stoppedAfterFile };
    }
    try {
      cases.push(JSON.parse(text));
    } catch {
      return {
        ok: false,
        result: terminalResult({
          code: "invalid-dataset",
          issues: [{ path: `/cases/${entry.name}`, code: "invalid-json" }],
        }),
      };
    }
  }
  const stoppedAfterRead = stoppedResult(signal, deadline, clock);
  return stoppedAfterRead === undefined
    ? { ok: true, cases }
    : { ok: false, result: stoppedAfterRead };
}

async function main(): Promise<void> {
  if (process.argv.length > 2) {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 2;
    return;
  }
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    const deadline = Date.now() + deadlineMilliseconds;
    let loadedCases: Awaited<ReturnType<typeof loadCases>>;
    try {
      loadedCases = await loadCases(controller.signal, deadline, Date.now);
    } catch {
      loadedCases = {
        ok: false,
        result: terminalResult({
          code: "invalid-dataset",
          issues: [{ path: "/cases", code: "unreadable" }],
        }),
      };
    }
    if (!loadedCases.ok) {
      const result = loadedCases.result;
      const encoded = evaluationV1.encodeResult(result);
      if (!encoded.ok) {
        throw new Error("Unable to encode the evaluation failure result.");
      }
      process.stderr.write(`${encoded.value}\n`);
      process.exitCode = 1;
      return;
    }
    const rawCases = loadedCases.cases;
    const baselineResults = new Map<string, ReviewResultEnvelope>();
    const candidateOutcomes = new Map<string, AnalyzerOutcomeEnvelope[]>();
    for (const rawCase of rawCases) {
      const decoded = evaluationV1.decodeCase(rawCase);
      if (decoded.ok) {
        baselineResults.set(decoded.value.caseId, decoded.value.baselineResult);
        candidateOutcomes.set(decoded.value.caseId, decoded.value.candidateOutcomes);
      }
    }
    const baseline: ReplayTarget = {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "deterministic-v1" },
      async run(_request, context) {
        return structuredClone(baselineResults.get(context.caseId));
      },
    };
    const candidate: ReplayTarget = {
      descriptor: { name: "current-review", version: "0.0.0", profile: "deterministic-v1" },
      async run(request, context) {
        const outcomes = candidateOutcomes.get(context.caseId);
        if (outcomes === undefined) {
          return undefined;
        }
        const review = createReviewUseCase({
          clock: Date.now,
          analyze: async () => structuredClone(outcomes),
        });
        return review.review(request, {
          signal: context.signal,
          deadline: context.deadline,
          limits: analyzerLimits,
        });
      },
    };
    const result = await evaluationV1
      .createComparer({ baseline, candidate, clock: Date.now })
      .compare(rawCases, {
        signal: controller.signal,
        deadline,
        limits: unrestrictedCallerLimits,
      });
    const encoded = evaluationV1.encodeResult(result);
    if (!encoded.ok) {
      throw new Error("Unable to encode the evaluation result.");
    }
    if (!result.payload.ok) {
      process.stderr.write(`${encoded.value}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${encoded.value}\n`);
    process.exitCode = result.payload.gate === "pass" ? 0 : 1;
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

await main();
