import assert from "node:assert/strict";
import test from "node:test";

import { createReviewUseCase, reviewContractV1 } from "../src/index.ts";

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

test("returns a versioned complete report from one analyzed outcome", async () => {
  const review = createReviewUseCase({
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

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "deterministic-security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
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
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
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

test("orders analyzer facts independently of outcome completion order", async () => {
  const descriptor = (tool: string) => ({
    tool,
    version: "1.0.0",
    profile: "deterministic-security",
    rules: [`${tool}/rule`],
  });
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () =>
      ["zeta", "alpha"].map((tool) => ({
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: descriptor(tool),
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [],
        },
      })),
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "deterministic-security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.deepEqual(
    {
      analyzers: result.payload.report.analyzers,
      analyses: result.payload.report.coverage.files[0]?.analyses,
    },
    {
      analyzers: [descriptor("alpha"), descriptor("zeta")],
      analyses: [
        { analyzer: descriptor("alpha"), status: "analyzed", side: "new" },
        { analyzer: descriptor("zeta"), status: "analyzed", side: "new" },
      ],
    },
  );
});

test("rejects duplicate analyzer identities that cannot be ordered independently", async () => {
  const outcome = {
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
  };
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [outcome, outcome],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "deterministic-security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-outcome",
        issues: [{ path: "/1/payload/analyzer", code: "duplicate" }],
      },
    },
  });
});

test("keeps analyzer identity fields unambiguous when values contain delimiters", async () => {
  const descriptor = (tool: string, version: string) => ({
    tool,
    version,
    profile: "security",
    rules: ["security/rule"],
  });
  const first = descriptor("alpha", "beta\0gamma");
  const second = descriptor("alpha\0beta", "gamma");
  const outcome = (analyzer: ReturnType<typeof descriptor>) => ({
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer,
      status: "analyzed",
      files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
      candidates: [],
    },
  });
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [outcome(second), outcome(first)],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "deterministic-security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.deepEqual(result.payload.report.analyzers, [first, second]);
});

test("keeps a skipped analyzer outcome as truthful no coverage", async () => {
  const analyzer = {
    tool: "biome",
    version: "2.5.8",
    profile: "deterministic-security",
    rules: ["lint/security/noGlobalEval"],
  };
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer,
          status: "skipped",
          files: [{ side: "new", path: "src/value.ts", status: "skipped", reason: "unsupported" }],
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "deterministic-security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.deepEqual(result.payload.report.coverage, {
    status: "no-coverage",
    files: [
      {
        oldPath: "src/value.ts",
        newPath: "src/value.ts",
        status: "modified",
        baseSource: "available",
        headSource: "available",
        analyses: [{ analyzer, status: "skipped", reason: "unsupported", side: "new" }],
      },
    ],
  });
});

test("returns only validated partial facts when one required analyzer fails", async () => {
  const analyzed = {
    tool: "alpha",
    version: "1.0.0",
    profile: "security",
    rules: ["alpha/no-eval"],
  };
  const failed = {
    tool: "zeta",
    version: "1.0.0",
    profile: "security",
    rules: ["zeta/no-eval"],
  };
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: analyzed,
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [
            {
              ruleId: "alpha/no-eval",
              severity: "high",
              title: "Avoid eval",
              explanation: "Dynamic evaluation can execute untrusted code.",
              location: { side: "new", path: "src/value.ts", line: 1 },
              fixGuidance: "Use a parser.",
              suggestedTests: "Exercise untrusted input.",
              confidence: 0.99,
              provenance: { tool: "alpha", version: "1.0.0", ruleId: "alpha/no-eval" },
            },
          ],
        },
      },
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: failed,
          status: "failed",
          files: [{ side: "new", path: "src/value.ts", status: "failed" }],
          diagnostic: {
            code: "execution-failed",
            message: "The analyzer did not complete successfully.",
          },
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = eval(input);",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
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
      ok: false,
      error: { code: "required-analyzer-failed", stage: "analyze" },
      partial: {
        coverage: {
          status: "partial",
          files: [
            {
              oldPath: "src/value.ts",
              newPath: "src/value.ts",
              status: "modified",
              baseSource: "available",
              headSource: "available",
              analyses: [
                { analyzer: analyzed, status: "analyzed", side: "new" },
                { analyzer: failed, status: "failed", side: "new" },
              ],
            },
          ],
        },
        analyzers: [analyzed, failed],
        diagnostics: [
          {
            analyzer: failed,
            code: "execution-failed",
            message: "The analyzer did not complete successfully.",
          },
        ],
        findings: [
          {
            ruleId: "alpha/no-eval",
            severity: "high",
            title: "Avoid eval",
            explanation: "Dynamic evaluation can execute untrusted code.",
            location: { side: "new", path: "src/value.ts", line: 1 },
            fixGuidance: "Use a parser.",
            suggestedTests: "Exercise untrusted input.",
            confidence: 0.99,
            provenance: { tool: "alpha", version: "1.0.0", ruleId: "alpha/no-eval" },
            evidence: "export const value = eval(input);",
          },
        ],
      },
    },
  });
  assert.equal("summary" in result.payload.partial, false);
  assert.equal("risk" in result.payload.partial, false);
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("orders findings by diff location before analyzer identity", async () => {
  const descriptor = (tool: string) => ({
    tool,
    version: "1.0.0",
    profile: "security",
    rules: [`${tool}/rule`],
  });
  const candidate = (tool: string, path: string) => ({
    ruleId: `${tool}/rule`,
    severity: "low",
    title: `${tool} finding`,
    explanation: `${tool} explanation`,
    location: { side: "new", path, line: 1 },
    fixGuidance: `${tool} guidance`,
    suggestedTests: `${tool} tests`,
    confidence: 0.8,
    provenance: { tool, version: "1.0.0", ruleId: `${tool}/rule` },
  });
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: descriptor("zeta"),
          status: "analyzed",
          files: [{ side: "new", path: "src/a.ts", status: "analyzed" }],
          candidates: [candidate("zeta", "src/a.ts")],
        },
      },
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: descriptor("alpha"),
          status: "analyzed",
          files: [{ side: "new", path: "src/b.ts", status: "analyzed" }],
          candidates: [candidate("alpha", "src/b.ts")],
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/a.ts b/src/a.ts",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1 +1 @@",
          "-export const a = 1;",
          "+export const a = 2;",
          "diff --git a/src/b.ts b/src/b.ts",
          "--- a/src/b.ts",
          "+++ b/src/b.ts",
          "@@ -1 +1 @@",
          "-export const b = 1;",
          "+export const b = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [
            { path: "src/a.ts", content: "export const a = 1;\n" },
            { path: "src/b.ts", content: "export const b = 1;\n" },
          ],
          head: [
            { path: "src/a.ts", content: "export const a = 2;\n" },
            { path: "src/b.ts", content: "export const b = 2;\n" },
          ],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.deepEqual(
    result.payload.report.findings.map((finding) => finding.ruleId),
    ["zeta/rule", "alpha/rule"],
  );
});

test("returns a top-level cancellation before analyzer execution", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      calls += 1;
      return [];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: "diff --git a/src/value.ts b/src/value.ts\n",
        sources: { base: [], head: [] },
      },
    },
    { ...context, signal: controller.signal },
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "cancelled", stage: "start" },
    },
  });
  assert.equal(calls, 0);
});

test("returns a top-level deadline before analyzer execution", async () => {
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => 10_000,
    analyze: async () => {
      calls += 1;
      return [];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: "diff --git a/src/value.ts b/src/value.ts\n",
        sources: { base: [], head: [] },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "deadline-exceeded", stage: "start" },
    },
  });
  assert.equal(calls, 0);
});

test("does not start analysis when the deadline expires during input validation", async () => {
  let clockReads = 0;
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => (clockReads++ === 0 ? 0 : 10_000),
    analyze: async () => {
      calls += 1;
      return [];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "deadline-exceeded", stage: "start" },
    },
  });
  assert.equal(calls, 0);
});

test("returns a top-level cancellation after analyzer execution", async () => {
  const controller = new AbortController();
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      controller.abort();
      return [
        {
          kind: "eve-reviewer.analyzer-outcome",
          schemaVersion: 1,
          payload: {
            analyzer: {
              tool: "biome",
              version: "2.5.8",
              profile: "security",
              rules: ["lint/security/noGlobalEval"],
            },
            status: "analyzed",
            files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
            candidates: [],
          },
        },
      ];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    { ...context, signal: controller.signal },
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "cancelled", stage: "analyze" },
    },
  });
});

test("returns a top-level deadline after analyzer execution", async () => {
  let now = 0;
  const review = createReviewUseCase({
    clock: () => now,
    analyze: async () => {
      now = 10_000;
      return [
        {
          kind: "eve-reviewer.analyzer-outcome",
          schemaVersion: 1,
          payload: {
            analyzer: {
              tool: "biome",
              version: "2.5.8",
              profile: "security",
              rules: ["lint/security/noGlobalEval"],
            },
            status: "analyzed",
            files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
            candidates: [],
          },
        },
      ];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "deadline-exceeded", stage: "analyze" },
    },
  });
});

test("returns an encodable contract rejection for a malformed request", async () => {
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      calls += 1;
      return [];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      payload: {},
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-request",
        issues: [{ path: "/schemaVersion", code: "required" }],
      },
    },
  });
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
  assert.equal(calls, 0);
});

test("returns an encodable domain rejection for an invalid diff", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: "not a unified diff",
        sources: { base: [], head: [] },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, false);
  assert.ok("error" in result.payload);
  assert.equal(result.payload.error.code, "invalid-diff");
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("returns an encodable bounded failure when the analyzer Adapter throws", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      throw new Error("raw Adapter secret");
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "analyzer-execution-failed",
        stage: "analyze",
        message: "The analyzer Adapter did not complete successfully.",
      },
    },
  });
  assert.equal(JSON.stringify(result).includes("raw Adapter secret"), false);
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("rejects a non-array analyzer result at runtime", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => ({ status: "analyzed" }) as unknown as unknown[],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-outcome",
        issues: [{ path: "/", code: "array" }],
      },
    },
  });
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("rejects analyzer outcome arrays above the Eve-owned count limit", async () => {
  const outcome = {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "security",
        rules: ["lint/security/noGlobalEval"],
      },
      status: "analyzed",
      files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
      candidates: [],
    },
  };
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => Array.from({ length: 101 }, () => outcome),
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-outcome",
        issues: [{ path: "/", code: "max-items" }],
      },
    },
  });
});

test("elevates an analyzer cancellation diagnostic to a top-level terminal", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "security",
            rules: ["lint/security/noGlobalEval"],
          },
          status: "failed",
          files: [{ side: "new", path: "src/value.ts", status: "failed" }],
          diagnostic: {
            code: "cancelled",
            message: "The analyzer was cancelled.",
            cleanupIncomplete: true,
          },
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "cancelled", stage: "analyze", cleanupIncomplete: true },
    },
  });
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("enforces caller-tightened source limits before analyzer execution", async () => {
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      calls += 1;
      return [];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    {
      ...context,
      limits: { ...context.limits, maximumSourceFileBytes: 1 },
    },
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-source",
        message: "Base source file exceeds the 1-byte limit: src/value.ts.",
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("does not let a non-numeric caller limit bypass source validation", async () => {
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      calls += 1;
      return [];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-x",
          "+y",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "x\n" }],
          head: [{ path: "src/value.ts", content: "y\n" }],
        },
      },
    },
    {
      ...context,
      limits: { ...context.limits, maximumSourceFileBytes: Number.NaN },
    },
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-source",
        message: "Base source file exceeds the 0-byte limit: src/value.ts.",
      },
    },
  });
  assert.equal(calls, 0);
});

test("returns an encodable side-aware source mismatch", async () => {
  let calls = 0;
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => {
      calls += 1;
      return [
        {
          kind: "eve-reviewer.analyzer-outcome",
          schemaVersion: 1,
          payload: {
            analyzer: {
              tool: "biome",
              version: "2.5.8",
              profile: "security",
              rules: ["lint/security/noGlobalEval"],
            },
            status: "analyzed",
            files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
            candidates: [],
          },
        },
      ];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 3;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "source-mismatch",
        message: "Source snapshot does not match the diff at new src/value.ts:1.",
        source: { side: "new", path: "src/value.ts", line: 1 },
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("isolates validated review truth from analyzer input mutation", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async (input) => {
      input.subject.repository = "mutated/repository";
      const headSource = input.sources.head[0];
      if (headSource !== undefined) {
        headSource.content = "export const value = 3;\n";
      }
      const changedFile = input.diff.files[0];
      if (changedFile !== undefined) {
        changedFile.newPath = "src/mutated.ts";
      }
      return [
        {
          kind: "eve-reviewer.analyzer-outcome",
          schemaVersion: 1,
          payload: {
            analyzer: {
              tool: "biome",
              version: "2.5.8",
              profile: "security",
              rules: ["lint/security/noGlobalEval"],
            },
            status: "analyzed",
            files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
            candidates: [],
          },
        },
      ];
    },
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.deepEqual(result.payload.report.subject, {
    kind: "pull-request",
    repository: "example/repository",
    number: 7,
  });
  assert.equal(result.payload.report.coverage.status, "complete");
});

test("isolates the returned result from later analyzer outcome mutation", async () => {
  const outcome = {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "security",
        rules: ["lint/security/noGlobalEval"],
      },
      status: "analyzed",
      files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
      candidates: [],
    },
  };
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [outcome],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );
  outcome.payload.analyzer.tool = "mutated";
  const outcomeFile = outcome.payload.files[0];
  if (outcomeFile !== undefined) {
    outcomeFile.path = "src/mutated.ts";
  }

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.equal(result.payload.report.analyzers[0]?.tool, "biome");
  assert.equal(result.payload.report.coverage.files[0]?.analyses[0]?.analyzer.tool, "biome");
});

test("returns an encodable invalid evidence location", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "security",
            rules: ["lint/security/noGlobalEval"],
          },
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [
            {
              ruleId: "security/no-dynamic-eval",
              severity: "critical",
              title: "Dynamic code evaluation",
              explanation: "Code added by the change evaluates text as executable code.",
              location: { side: "new", path: "src/value.ts", line: 2 },
              fixGuidance: "Use a parser.",
              suggestedTests: "Exercise hostile input.",
              confidence: 0.95,
              provenance: {
                tool: "biome",
                version: "2.5.8",
                ruleId: "lint/security/noGlobalEval",
              },
            },
          ],
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, false);
  assert.ok("error" in result.payload);
  assert.deepEqual(result.payload.error, {
    code: "invalid-evidence-location",
    message:
      "Finding security/no-dynamic-eval references new src/value.ts:2, which is not a changed line on that side.",
    finding: {
      ruleId: "security/no-dynamic-eval",
      location: { side: "new", path: "src/value.ts", line: 2 },
    },
  });
  assert.equal(reviewContractV1.encodeResult(result).ok, true);
});

test("rejects analyzer file cells that do not map to the diff", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "security",
            rules: ["lint/security/noGlobalEval"],
          },
          status: "analyzed",
          files: [{ side: "new", path: "src/other.ts", status: "analyzed" }],
          candidates: [],
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-outcome",
        issues: [{ path: "/0/payload/files/0/path", code: "mismatch" }],
      },
    },
  });
});

test("rejects duplicate file classifications from one analyzer outcome", async () => {
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "biome",
            version: "2.5.8",
            profile: "security",
            rules: ["lint/security/noGlobalEval"],
          },
          status: "analyzed",
          files: [
            { side: "new", path: "src/value.ts", status: "analyzed" },
            { side: "new", path: "src/value.ts", status: "analyzed" },
          ],
          candidates: [],
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-outcome",
        issues: [{ path: "/0/payload/files/1/path", code: "mismatch" }],
      },
    },
  });
});

test("rejects aggregate candidates above the Eve-owned count limit", async () => {
  const candidate = (tool: string) => ({
    ruleId: "security/no-dynamic-eval",
    severity: "critical",
    title: "Dynamic code evaluation",
    explanation: "Code added by the change evaluates text as executable code.",
    location: { side: "new", path: "src/value.ts", line: 1 },
    fixGuidance: "Use a parser.",
    suggestedTests: "Exercise hostile input.",
    confidence: 0.95,
    provenance: {
      tool,
      version: "2.5.8",
      ruleId: `${tool}/noGlobalEval`,
    },
  });
  const outcome = (tool: string) => ({
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: {
        tool,
        version: "2.5.8",
        profile: "security",
        rules: [`${tool}/noGlobalEval`],
      },
      status: "analyzed",
      files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
      candidates: Array.from({ length: 501 }, () => candidate(tool)),
    },
  });
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [outcome("alpha"), outcome("zeta")],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.deepEqual(result, {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-outcome",
        issues: [{ path: "/", code: "max-items" }],
      },
    },
  });
});

test("derives the success summary from the analyzer-by-file matrix", async () => {
  const descriptor = (tool: string) => ({
    tool,
    version: "1.0.0",
    profile: "security",
    rules: [`${tool}/rule`],
  });
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: descriptor("alpha"),
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [],
        },
      },
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: descriptor("zeta"),
          status: "skipped",
          files: [{ side: "new", path: "src/value.ts", status: "skipped", reason: "unsupported" }],
        },
      },
    ],
  });

  const result = await review.review(
    {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: {
          kind: "pull-request",
          repository: "example/repository",
          number: 7,
        },
        reviewer: "security",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "--- a/src/value.ts",
          "+++ b/src/value.ts",
          "@@ -1 +1 @@",
          "-export const value = 1;",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    context,
  );

  assert.equal(result.payload.ok, true);
  assert.ok("report" in result.payload);
  assert.equal(result.payload.report.coverage.status, "partial");
  assert.equal(
    result.payload.report.summary,
    "0 findings across 1 changed file; coverage: partial; highest severity: none.",
  );
});
