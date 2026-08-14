#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";

import { buildValidatedReport, MAX_DIFF_BYTES, parseUnifiedDiff } from "@eve-reviewer/core";

import { reviewWithBiome } from "./biome-reviewer.ts";

function invalidDiff(message: string): void {
  process.stderr.write(`${JSON.stringify({ code: "invalid-diff", message })}\n`);
  process.exitCode = 1;
}

function sourceUnavailable(): void {
  process.stderr.write(
    `${JSON.stringify({ code: "source-unavailable", message: "Syntax-aware review requires complete post-change source." })}\n`,
  );
  process.exitCode = 1;
}

const args = process.argv.slice(2);
const repositoryIndex = args.indexOf("--repository");
const pullRequestIndex = args.indexOf("--pull-request");
const sourceRootIndex = args.indexOf("--source-root");
const diffPath = args.at(-1);
const repository = repositoryIndex >= 0 ? args[repositoryIndex + 1] : undefined;
const pullRequestValue = pullRequestIndex >= 0 ? args[pullRequestIndex + 1] : undefined;
const sourceRoot = sourceRootIndex >= 0 ? args[sourceRootIndex + 1] : undefined;

if (repository === undefined || pullRequestValue === undefined || diffPath === undefined) {
  process.stderr.write(
    "Usage: eve-reviewer --repository <owner/name> --pull-request <number> [--source-root <directory>] <diff-file>\n",
  );
  process.exitCode = 2;
} else {
  const pullRequest = Number(pullRequestValue);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    process.stderr.write("Repository must use owner/name format.\n");
    process.exitCode = 2;
  } else if (!Number.isSafeInteger(pullRequest) || pullRequest <= 0) {
    process.stderr.write("Pull request must be a positive integer.\n");
    process.exitCode = 2;
  } else {
    let diffSize: number;
    try {
      diffSize = statSync(diffPath).size;
    } catch {
      diffSize = -1;
    }
    if (diffSize < 0) {
      invalidDiff("Unable to read diff input.");
    } else if (diffSize > MAX_DIFF_BYTES) {
      invalidDiff(`Diff exceeds the ${MAX_DIFF_BYTES}-byte input limit.`);
    } else {
      let diff: string | undefined;
      try {
        diff = readFileSync(diffPath, "utf8");
      } catch {
        invalidDiff("Unable to read diff input.");
      }
      if (diff !== undefined) {
        const parsed = parseUnifiedDiff(diff);
        if (!parsed.ok) {
          process.stderr.write(`${JSON.stringify(parsed.error)}\n`);
          process.exitCode = 1;
        } else if (sourceRoot === undefined) {
          sourceUnavailable();
        } else {
          const review = reviewWithBiome(parsed.diff, sourceRoot);
          if (!review.ok) {
            process.stderr.write(`${JSON.stringify(review.error)}\n`);
            process.exitCode = 1;
          } else {
            const result = buildValidatedReport({
              repository,
              pullRequest,
              reviewer: "deterministic-security",
              diff,
              sources: { base: [], head: review.sources },
              analyzedFiles: review.analyzedFiles,
              candidates: review.candidates,
            });

            if (!result.ok) {
              process.stderr.write(`${JSON.stringify(result.error)}\n`);
              process.exitCode = 1;
            } else {
              process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
            }
          }
        }
      }
    }
  }
}
