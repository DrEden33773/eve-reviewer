#!/usr/bin/env node

import { createDeterministicReviewer, MAX_DIFF_BYTES, parseUnifiedDiff } from "@eve-reviewer/core";

import { readBoundedTextFile } from "./bounded-file.ts";
import { executeLocalBiome, loadHeadSources, localAnalyzerLimits } from "./local-biome.ts";

const usage =
  "Usage: eve-reviewer --repository <owner/name> --pull-request <number> [--source-root <directory>] <diff-file>";
const defaultDeadlineMilliseconds = 5_000;

function writeTypedFailure(error: object): void {
  process.stderr.write(`${JSON.stringify(error)}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repositoryIndex = args.indexOf("--repository");
  const pullRequestIndex = args.indexOf("--pull-request");
  const sourceRootIndex = args.indexOf("--source-root");
  const diffPath = args.at(-1);
  const repository = repositoryIndex >= 0 ? args[repositoryIndex + 1] : undefined;
  const pullRequestValue = pullRequestIndex >= 0 ? args[pullRequestIndex + 1] : undefined;
  const sourceRoot = sourceRootIndex >= 0 ? args[sourceRootIndex + 1] : undefined;

  if (repository === undefined || pullRequestValue === undefined || diffPath === undefined) {
    process.stderr.write(`${usage}\n`);
    process.exitCode = 2;
    return;
  }
  const pullRequest = Number(pullRequestValue);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    process.stderr.write("Repository must use owner/name format.\n");
    process.exitCode = 2;
    return;
  }
  if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) {
    process.stderr.write("Pull request must be a positive integer.\n");
    process.exitCode = 2;
    return;
  }

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  const deadline = Date.now() + defaultDeadlineMilliseconds;

  try {
    const diffInput = await readBoundedTextFile(diffPath, MAX_DIFF_BYTES, {
      signal: controller.signal,
      deadline,
      graceMilliseconds: localAnalyzerLimits.terminationGraceMilliseconds,
    });
    if (!diffInput.ok) {
      if (diffInput.failure === "limit") {
        writeTypedFailure({
          code: "invalid-diff",
          message: `Diff exceeds the ${MAX_DIFF_BYTES}-byte input limit.`,
        });
        return;
      }
      if (diffInput.failure === "cancelled" || diffInput.failure === "deadline") {
        writeTypedFailure({
          code: diffInput.failure === "cancelled" ? "cancelled" : "deadline-exceeded",
          stage: "start",
          message:
            diffInput.failure === "cancelled"
              ? "The deterministic review was cancelled while reading diff input."
              : "The deterministic review deadline elapsed while reading diff input.",
          ...(diffInput.cleanupIncomplete ? { cleanupIncomplete: true } : {}),
        });
        return;
      }
      writeTypedFailure({ code: "invalid-diff", message: "Unable to read diff input." });
      return;
    }
    const parsed = parseUnifiedDiff(diffInput.text);
    if (!parsed.ok) {
      writeTypedFailure(parsed.error);
      return;
    }
    if (sourceRoot === undefined) {
      writeTypedFailure({
        code: "source-unavailable",
        message: "Syntax-aware review requires complete post-change source.",
      });
      return;
    }
    const loaded = await loadHeadSources(parsed.diff, sourceRoot, localAnalyzerLimits, {
      signal: controller.signal,
      deadline,
    });
    if (!loaded.ok) {
      writeTypedFailure(loaded.error);
      return;
    }

    const reviewer = createDeterministicReviewer({
      executeAnalyzer: executeLocalBiome,
      clock: Date.now,
    });
    const result = await reviewer.review(
      {
        repository,
        pullRequest,
        reviewer: "deterministic-security",
        diff: parsed.diff,
        sources: { base: [], head: loaded.sources },
      },
      {
        signal: controller.signal,
        deadline,
        limits: localAnalyzerLimits,
      },
    );
    if (!result.ok) {
      writeTypedFailure(result.error);
      return;
    }
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } finally {
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

await main();
