import assert from "node:assert/strict";
import test from "node:test";

import { createLocalReviewUseCase, localReviewContractV1, reviewContractV1 } from "../src/index.ts";

const context = {
  signal: new AbortController().signal,
  deadline: 10_000,
  limits: {
    maximumSourceFiles: 100,
    maximumSourceFileBytes: 1_000_000,
    maximumSnapshotBytes: 5_000_000,
    maximumStdoutBytes: 1_000_000,
    maximumStderrBytes: 1_000_000,
    maximumReportBytes: 5_000_000,
    terminationGraceMilliseconds: 100,
  },
};

test("the local review contract accepts one exact captured worktree request", () => {
  const request = {
    kind: "eve-reviewer.local-review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "local-worktree",
        objectFormat: "sha1",
        base: {
          kind: "head",
          commit: "a".repeat(40),
          tree: "b".repeat(40),
        },
        candidateTree: "c".repeat(40),
        snapshotDigest: `sha256:${"d".repeat(64)}`,
      },
      reviewer: "deterministic-security",
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "--- a/src/value.ts",
        "+++ b/src/value.ts",
        "@@ -1 +1 @@",
        "-export const value = input;",
        "+export const value = eval(input);",
        "",
      ].join("\n"),
      sources: {
        base: [{ path: "src/value.ts", content: "export const value = input;\n" }],
        head: [{ path: "src/value.ts", content: "export const value = eval(input);\n" }],
      },
    },
  } as const;

  assert.deepEqual(localReviewContractV1.decodeRequest(request), {
    ok: true,
    value: request,
  });
});

test("the local review contract accepts an exact sha256 unborn worktree request", () => {
  const request = {
    kind: "eve-reviewer.local-review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "local-worktree",
        objectFormat: "sha256",
        base: {
          kind: "unborn",
          tree: "a".repeat(64),
        },
        candidateTree: "b".repeat(64),
        snapshotDigest: `sha256:${"c".repeat(64)}`,
      },
      reviewer: "deterministic-security",
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/value.ts",
        "@@ -0,0 +1 @@",
        "+export const value = 1;",
        "",
      ].join("\n"),
      sources: {
        base: [],
        head: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
      },
    },
  } as const;

  assert.deepEqual(localReviewContractV1.decodeRequest(request), {
    ok: true,
    value: request,
  });
});

test("the local review contract rejects object identifiers that contradict their format", () => {
  const decoded = localReviewContractV1.decodeRequest({
    kind: "eve-reviewer.local-review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "local-worktree",
        objectFormat: "sha1",
        base: {
          kind: "unborn",
          tree: "a".repeat(64),
        },
        candidateTree: "b".repeat(64),
        snapshotDigest: `sha256:${"c".repeat(64)}`,
      },
      reviewer: "deterministic-security",
      diff: [
        "diff --git a/src/value.ts b/src/value.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/value.ts",
        "@@ -0,0 +1 @@",
        "+export const value = 1;",
        "",
      ].join("\n"),
      sources: {
        base: [],
        head: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
      },
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-request",
      issues: [{ path: "/payload/subject/objectFormat", code: "object-format-mismatch" }],
    },
  });
});

test("the local review use case reports against captured worktree identity", async () => {
  const review = createLocalReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "deterministic-security",
            rules: ["lint/security/noGlobalEval"],
          },
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [],
        },
      },
    ],
  });
  const subject = {
    kind: "local-worktree",
    objectFormat: "sha1",
    base: {
      kind: "head",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
    },
    candidateTree: "c".repeat(40),
    snapshotDigest: `sha256:${"d".repeat(64)}`,
  } as const;

  const result = await review.review(
    {
      kind: "eve-reviewer.local-review-request",
      schemaVersion: 1,
      payload: {
        subject,
        reviewer: "deterministic-security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = input;",
          "+export const value = eval(input);",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = input;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = eval(input);\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject,
        reviewer: "deterministic-security",
        summary: "0 findings across 1 changed file; coverage: complete; highest severity: none.",
        risk: "none",
        coverage: {
          status: "complete",
          files: [
            {
              oldPath: "src/value.ts",
              newPath: "src/value.ts",
              status: "modified",
              baseSource: "available",
              headSource: "available",
              analyses: [
                {
                  analyzer: {
                    tool: "biome",
                    version: "2.5.8",
                    profile: "deterministic-security",
                    rules: ["lint/security/noGlobalEval"],
                  },
                  status: "analyzed",
                  side: "new",
                },
              ],
            },
          ],
        },
        analyzers: [
          {
            tool: "biome",
            version: "2.5.8",
            profile: "deterministic-security",
            rules: ["lint/security/noGlobalEval"],
          },
        ],
        diagnostics: [],
        findings: [],
      },
    },
  });
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});
