import assert from "node:assert/strict";
import test from "node:test";

import { type EvaluationResultEnvelope, evaluationV1 } from "../src/index.ts";

type CompleteEvaluationPayload = Extract<EvaluationResultEnvelope["payload"], { ok: true }>;

function completePayload(result: EvaluationResultEnvelope): CompleteEvaluationPayload {
  assert.equal(result.payload.ok, true);
  if (!result.payload.ok) {
    throw new Error("Expected a complete evaluation result.");
  }
  return result.payload;
}

const invalidDiffResult = {
  kind: "eve-reviewer.review-result",
  schemaVersion: 1,
  payload: {
    ok: false,
    error: { code: "invalid-diff", message: "The diff is invalid." },
  },
} as const;

const evaluationCase = {
  kind: "eve-reviewer.evaluation-case",
  schemaVersion: 1,
  caseId: "invalid-diff",
  source: "synthetic-controlled",
  request: {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "pull-request",
        repository: "example/repository",
        number: 7,
      },
      reviewer: "deterministic-security",
      diff: "diff --git a/src/value.ts b/src/value.ts\n",
      sources: { base: [], head: [] },
    },
  },
  baselineResult: invalidDiffResult,
  candidateOutcomes: [
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
        status: "skipped",
        files: [
          {
            side: "new",
            path: "src/value.ts",
            status: "skipped",
            reason: "source-unavailable",
          },
        ],
      },
    },
  ],
  protected: {
    result: { ok: false, errorCode: "invalid-diff" },
    analyzers: [],
    findings: [],
  },
} as const;

const context = {
  signal: new AbortController().signal,
  deadline: 10_000,
  limits: {
    maximumDatasetBytes: 12_000_000,
    maximumCases: 100,
    maximumProtectedFacts: 10_000,
    maximumFindings: 10_000,
    maximumResultBytes: 5_000_000,
    maximumIssues: 1_000,
    maximumIssueValueCharacters: 2_048,
  },
};

const analyzer = {
  tool: "biome",
  version: "2.5.8",
  profile: "deterministic-security",
  rules: ["lint/security/noGlobalEval"],
} as const;

const coverage = {
  status: "complete",
  files: [
    {
      oldPath: "src/value.ts",
      newPath: "src/value.ts",
      status: "modified",
      baseSource: "available",
      headSource: "available",
      analyses: [{ analyzer, status: "analyzed", side: "new" }],
    },
  ],
} as const;

const unexpectedFinding = {
  ruleId: "security/no-dynamic-eval",
  severity: "critical",
  title: "Dynamic code evaluation",
  explanation: "Code added by the change evaluates text as executable code.",
  location: { side: "new", path: "src/value.ts", line: 1 },
  fixGuidance: "Replace eval with an explicit parser.",
  suggestedTests: "Assert hostile input is never executed.",
  confidence: 0.95,
  provenance: {
    tool: "biome",
    version: "2.5.8",
    ruleId: "lint/security/noGlobalEval",
  },
  evidence: "export const value = eval(input);",
} as const;

const protectedUnexpectedFinding = {
  ruleId: unexpectedFinding.ruleId,
  severity: unexpectedFinding.severity,
  location: unexpectedFinding.location,
  evidence: unexpectedFinding.evidence,
  provenance: unexpectedFinding.provenance,
} as const;

test("compares one passing baseline and candidate with literal metrics", async () => {
  const baseline = {
    descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
    run: async () => invalidDiffResult,
  };
  const candidate = {
    descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
    run: async () => invalidDiffResult,
  };
  const comparer = evaluationV1.createComparer({ baseline, candidate, clock: () => 0 });

  const result = await comparer.compare([evaluationCase], context);

  assert.equal(evaluationV1.decodeResult(result).ok, true);
  assert.deepEqual(result, {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      gate: "pass",
      targets: {
        baseline: baseline.descriptor,
        candidate: candidate.descriptor,
      },
      cases: [
        {
          caseId: "invalid-diff",
          delta: "unchanged-pass",
          baseline: { status: "matched", issues: [] },
          candidate: { status: "matched", issues: [] },
        },
      ],
      metrics: {
        baseline: {
          cases: { passed: 1, failed: 0 },
          assertions: { passed: 3, failed: 0 },
          findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
          coverage: { matched: 0, mismatched: 0 },
        },
        candidate: {
          cases: { passed: 1, failed: 0 },
          assertions: { passed: 3, failed: 0 },
          findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
          coverage: { matched: 0, mismatched: 0 },
        },
        delta: {
          regressions: 0,
          improvements: 0,
          unchangedPass: 1,
          unchangedFail: 0,
        },
        targetFailures: { baseline: 0, candidate: 0 },
      },
    },
  });
});

test("fails the gate when the candidate adds an unexpected protected finding", async () => {
  const request = {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "pull-request",
        repository: "example/repository",
        number: 8,
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
  const baselineResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject: request.payload.subject,
        reviewer: "deterministic-security",
        summary: "0 findings across 1 changed file; coverage: complete; highest severity: none.",
        risk: "none",
        coverage,
        analyzers: [analyzer],
        diagnostics: [],
        findings: [],
      },
    },
  } as const;
  const candidateResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject: request.payload.subject,
        reviewer: "deterministic-security",
        summary: "1 finding across 1 changed file; coverage: complete; highest severity: critical.",
        risk: "critical",
        coverage,
        analyzers: [analyzer],
        diagnostics: [],
        findings: [unexpectedFinding],
      },
    },
  } as const;
  const replayCase = {
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "unexpected-finding",
    source: "synthetic-controlled",
    request,
    baselineResult,
    candidateOutcomes: [
      {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer,
          status: "analyzed",
          files: [{ side: "new", path: "src/value.ts", status: "analyzed" }],
          candidates: [
            {
              ruleId: unexpectedFinding.ruleId,
              severity: unexpectedFinding.severity,
              title: unexpectedFinding.title,
              explanation: unexpectedFinding.explanation,
              location: unexpectedFinding.location,
              fixGuidance: unexpectedFinding.fixGuidance,
              suggestedTests: unexpectedFinding.suggestedTests,
              confidence: unexpectedFinding.confidence,
              provenance: unexpectedFinding.provenance,
            },
          ],
        },
      },
    ],
    protected: {
      result: { ok: true },
      coverage,
      analyzers: [analyzer],
      findings: [],
    },
  } as const;
  const baseline = {
    descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
    run: async () => baselineResult,
  };
  const candidate = {
    descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
    run: async () => candidateResult,
  };

  const result = await evaluationV1
    .createComparer({ baseline, candidate, clock: () => 0 })
    .compare([replayCase], context);

  assert.deepEqual(result, {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      gate: "fail",
      targets: { baseline: baseline.descriptor, candidate: candidate.descriptor },
      cases: [
        {
          caseId: "unexpected-finding",
          delta: "regression",
          baseline: { status: "matched", issues: [] },
          candidate: {
            status: "mismatched",
            issues: [
              {
                path: "/protected/findings",
                code: "unexpected",
                expected: [],
                actual: [
                  {
                    ruleId: unexpectedFinding.ruleId,
                    severity: unexpectedFinding.severity,
                    location: unexpectedFinding.location,
                    evidence: unexpectedFinding.evidence,
                    provenance: unexpectedFinding.provenance,
                  },
                ],
              },
            ],
          },
        },
      ],
      metrics: {
        baseline: {
          cases: { passed: 1, failed: 0 },
          assertions: { passed: 4, failed: 0 },
          findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
          coverage: { matched: 1, mismatched: 0 },
        },
        candidate: {
          cases: { passed: 0, failed: 1 },
          assertions: { passed: 3, failed: 1 },
          findings: { truePositive: 0, falsePositive: 1, falseNegative: 0 },
          coverage: { matched: 1, mismatched: 0 },
        },
        delta: {
          regressions: 1,
          improvements: 0,
          unchangedPass: 0,
          unchangedFail: 0,
        },
        targetFailures: { baseline: 0, candidate: 0 },
      },
    },
  });
});

test("counts duplicate protected findings as an exact multiset", async () => {
  const resultWithOneFinding = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject: evaluationCase.request.payload.subject,
        reviewer: "deterministic-security",
        summary: "1 finding across 1 changed file; coverage: complete; highest severity: critical.",
        risk: "critical",
        coverage,
        analyzers: [analyzer],
        diagnostics: [],
        findings: [unexpectedFinding],
      },
    },
  } as const;
  const duplicateCase = {
    ...evaluationCase,
    caseId: "duplicate-finding",
    baselineResult: resultWithOneFinding,
    protected: {
      result: { ok: true },
      coverage,
      analyzers: [analyzer],
      findings: [protectedUnexpectedFinding, protectedUnexpectedFinding],
    },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => resultWithOneFinding,
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => resultWithOneFinding,
    },
    clock: () => 0,
  });

  const result = await comparer.compare([duplicateCase], context);

  assert.deepEqual(result.payload, {
    ok: true,
    gate: "fail",
    targets: {
      baseline: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      candidate: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
    },
    cases: [
      {
        caseId: "duplicate-finding",
        delta: "unchanged-fail",
        baseline: {
          status: "mismatched",
          issues: [
            {
              path: "/protected/findings",
              code: "missing",
              expected: [protectedUnexpectedFinding, protectedUnexpectedFinding],
              actual: [protectedUnexpectedFinding],
            },
          ],
        },
        candidate: {
          status: "mismatched",
          issues: [
            {
              path: "/protected/findings",
              code: "missing",
              expected: [protectedUnexpectedFinding, protectedUnexpectedFinding],
              actual: [protectedUnexpectedFinding],
            },
          ],
        },
      },
    ],
    metrics: {
      baseline: {
        cases: { passed: 0, failed: 1 },
        assertions: { passed: 3, failed: 1 },
        findings: { truePositive: 1, falsePositive: 0, falseNegative: 1 },
        coverage: { matched: 1, mismatched: 0 },
      },
      candidate: {
        cases: { passed: 0, failed: 1 },
        assertions: { passed: 3, failed: 1 },
        findings: { truePositive: 1, falsePositive: 0, falseNegative: 1 },
        coverage: { matched: 1, mismatched: 0 },
      },
      delta: { regressions: 0, improvements: 0, unchangedPass: 0, unchangedFail: 1 },
      targetFailures: { baseline: 0, candidate: 0 },
    },
  });
});

test("reports exact coverage and file classification mismatches", async () => {
  const mismatchedCoverage = { ...coverage, status: "partial" } as const;
  const resultWithCoverage = (actualCoverage: typeof coverage | typeof mismatchedCoverage) =>
    ({
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: true,
        report: {
          subject: evaluationCase.request.payload.subject,
          reviewer: "deterministic-security",
          summary: "0 findings across 1 changed file; coverage: complete; highest severity: none.",
          risk: "none",
          coverage: actualCoverage,
          analyzers: [analyzer],
          diagnostics: [],
          findings: [],
        },
      },
    }) as const;
  const coverageCase = {
    ...evaluationCase,
    caseId: "coverage-mismatch",
    baselineResult: resultWithCoverage(coverage),
    protected: {
      result: { ok: true },
      coverage,
      analyzers: [analyzer],
      findings: [],
    },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => resultWithCoverage(coverage),
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => resultWithCoverage(mismatchedCoverage),
    },
    clock: () => 0,
  });

  const result = await comparer.compare([coverageCase], context);

  const payload = completePayload(result);
  assert.deepEqual(payload.cases, [
    {
      caseId: "coverage-mismatch",
      delta: "regression",
      baseline: { status: "matched", issues: [] },
      candidate: {
        status: "mismatched",
        issues: [
          {
            path: "/protected/coverage",
            code: "mismatch",
            expected: coverage,
            actual: mismatchedCoverage,
          },
        ],
      },
    },
  ]);
  assert.deepEqual(payload.metrics.candidate, {
    cases: { passed: 0, failed: 1 },
    assertions: { passed: 3, failed: 1 },
    findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
    coverage: { matched: 0, mismatched: 1 },
  });
});

test("rejects an invalid dataset before invoking either target", async () => {
  const invalidCase = structuredClone(evaluationCase) as { schemaVersion?: unknown };
  delete invalidCase.schemaVersion;
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([invalidCase], context);

  assert.equal(runs, 0);
  assert.deepEqual(result, {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-dataset",
        issues: [{ path: "/cases/0/schemaVersion", code: "required" }],
      },
    },
  });
});

test("collects target failures without exposing raw errors or inventing delta metrics", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        throw new Error("private baseline failure");
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return { kind: "not-a-review-result" };
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], context);

  assert.equal(runs, 2);
  assert.deepEqual(result, {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      gate: "fail",
      targets: {
        baseline: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
        candidate: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      },
      cases: [
        {
          caseId: "invalid-diff",
          baseline: {
            status: "failed",
            issues: [{ path: "/", code: "target-failed" }],
          },
          candidate: {
            status: "failed",
            issues: [{ path: "/", code: "invalid-result" }],
          },
        },
      ],
      metrics: {
        baseline: {
          cases: { passed: 0, failed: 0 },
          assertions: { passed: 0, failed: 0 },
          findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
          coverage: { matched: 0, mismatched: 0 },
        },
        candidate: {
          cases: { passed: 0, failed: 0 },
          assertions: { passed: 0, failed: 0 },
          findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
          coverage: { matched: 0, mismatched: 0 },
        },
        delta: { regressions: 0, improvements: 0, unchangedPass: 0, unchangedFail: 0 },
        targetFailures: { baseline: 1, candidate: 1 },
      },
    },
  });
});

test("reports every explicitly protected result, analyzer, summary, and risk mismatch", async () => {
  const successfulResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject: evaluationCase.request.payload.subject,
        reviewer: "deterministic-security",
        summary: "Protected summary.",
        risk: "none",
        coverage,
        analyzers: [analyzer],
        diagnostics: [],
        findings: [],
      },
    },
  } as const;
  const terminalResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "cancelled", stage: "start" },
    },
  } as const;
  const protectedCase = {
    ...evaluationCase,
    caseId: "protected-fields",
    baselineResult: successfulResult,
    protected: {
      result: { ok: true },
      coverage,
      analyzers: [analyzer],
      findings: [],
      summary: "Protected summary.",
      risk: "none",
    },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => successfulResult,
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => terminalResult,
    },
    clock: () => 0,
  });

  const result = await comparer.compare([protectedCase], context);

  const payload = completePayload(result);
  assert.deepEqual(payload.cases[0]?.candidate, {
    status: "mismatched",
    issues: [
      {
        path: "/protected/result",
        code: "mismatch",
        expected: { ok: true },
        actual: { ok: false, errorCode: "cancelled" },
      },
      { path: "/protected/coverage", code: "mismatch", expected: coverage },
      {
        path: "/protected/analyzers",
        code: "mismatch",
        expected: [analyzer],
        actual: [],
      },
      {
        path: "/protected/summary",
        code: "mismatch",
        expected: "Protected summary.",
      },
      { path: "/protected/risk", code: "mismatch", expected: "none" },
    ],
  });
  assert.deepEqual(payload.metrics.candidate, {
    cases: { passed: 0, failed: 1 },
    assertions: { passed: 1, failed: 5 },
    findings: { truePositive: 0, falsePositive: 0, falseNegative: 0 },
    coverage: { matched: 0, mismatched: 1 },
  });
});

test("stops after cancellation without running the candidate or emitting partial metrics", async () => {
  const controller = new AbortController();
  let candidateRuns = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        controller.abort();
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        candidateRuns += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    signal: controller.signal,
    limits: { ...context.limits, maximumResultBytes: 1 },
  });

  assert.equal(candidateRuns, 0);
  assert.deepEqual(result, {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: { ok: false, error: { code: "cancelled" } },
  });
});

test("rejects a dataset above the caller-tightened case limit before replay", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });
  const secondCase = { ...evaluationCase, caseId: "second-case" };

  const result = await comparer.compare([evaluationCase, secondCase], {
    ...context,
    limits: { ...context.limits, maximumCases: 1 },
  });

  assert.equal(runs, 0);
  assert.deepEqual(result, {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "limit-exceeded",
        issues: [{ path: "/limits/maximumCases", code: "exceeded", expected: 1, actual: 2 }],
      },
    },
  });
});

test("measures the bounded dataset as UTF-8 JSON before replay", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });
  const datasetBytes = new TextEncoder().encode(JSON.stringify([evaluationCase])).byteLength;

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumDatasetBytes: datasetBytes - 1 },
  });

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [
        {
          path: "/limits/maximumDatasetBytes",
          code: "exceeded",
          expected: datasetBytes - 1,
          actual: datasetBytes,
        },
      ],
    },
  });
});

test("bounds protected facts before replay", async () => {
  let runs = 0;
  const protectedCase = {
    ...evaluationCase,
    protected: { ...evaluationCase.protected, analyzers: [analyzer] },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([protectedCase], {
    ...context,
    limits: { ...context.limits, maximumProtectedFacts: 1 },
  });

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [{ path: "/limits/maximumProtectedFacts", code: "exceeded", expected: 1, actual: 2 }],
    },
  });
});

test("bounds literal and protected findings before replay", async () => {
  let runs = 0;
  const findingCase = {
    ...evaluationCase,
    protected: {
      ...evaluationCase.protected,
      findings: [protectedUnexpectedFinding, protectedUnexpectedFinding],
    },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([findingCase], {
    ...context,
    limits: { ...context.limits, maximumFindings: 1 },
  });

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [{ path: "/limits/maximumFindings", code: "exceeded", expected: 1, actual: 2 }],
    },
  });
});

test("rejects identical baseline and candidate target identities", async () => {
  let runs = 0;
  const descriptor = { name: "same-review", version: "1.0.0", profile: "same-profile" };
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor,
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { ...descriptor },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], context);

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-configuration",
      issues: [{ path: "/targets/candidate", code: "duplicate-target" }],
    },
  });
});

test("rejects duplicate case identifiers before replay", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase, structuredClone(evaluationCase)], context);

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-dataset",
      issues: [{ path: "/cases/1/caseId", code: "duplicate-case-id" }],
    },
  });
});

test("replays sorted cases baseline-first and records improvements", async () => {
  const calls: string[] = [];
  const cancelledResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: { ok: false, error: { code: "cancelled", stage: "start" } },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async (_request, targetContext) => {
        calls.push(`baseline:${targetContext.caseId}`);
        return targetContext.caseId === "a-improvement" ? cancelledResult : invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async (_request, targetContext) => {
        calls.push(`candidate:${targetContext.caseId}`);
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });
  const passCase = { ...evaluationCase, caseId: "z-pass" };
  const improvementCase = { ...evaluationCase, caseId: "a-improvement" };

  const result = await comparer.compare([passCase, improvementCase], context);

  assert.deepEqual(calls, [
    "baseline:a-improvement",
    "candidate:a-improvement",
    "baseline:z-pass",
    "candidate:z-pass",
  ]);
  const payload = completePayload(result);
  assert.equal(payload.gate, "pass");
  assert.deepEqual(
    payload.cases.map(({ caseId, delta }) => ({ caseId, delta })),
    [
      { caseId: "a-improvement", delta: "improvement" },
      { caseId: "z-pass", delta: "unchanged-pass" },
    ],
  );
  assert.deepEqual(payload.metrics.delta, {
    regressions: 0,
    improvements: 1,
    unchangedPass: 1,
    unchangedFail: 0,
  });
});

test("isolates each replay target from request and context mutation", async () => {
  const inputCase = structuredClone(evaluationCase);
  const originalReviewer = inputCase.request.payload.reviewer;
  let candidateObserved: { reviewer: string; caseId: string } | undefined;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async (request, targetContext) => {
        request.payload.reviewer = "mutated-by-baseline";
        targetContext.caseId = "mutated-by-baseline";
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async (request, targetContext) => {
        candidateObserved = {
          reviewer: request.payload.reviewer,
          caseId: targetContext.caseId,
        };
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  await comparer.compare([inputCase], context);

  assert.deepEqual(candidateObserved, {
    reviewer: originalReviewer,
    caseId: evaluationCase.caseId,
  });
  assert.equal(inputCase.request.payload.reviewer, originalReviewer);
});

test("runtime-validates strict target descriptors before replay", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: {
        name: "current-review",
        version: "1.0.0",
        profile: "f4-candidate",
        rawCommand: "must not be accepted",
      } as never,
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], context);

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-configuration",
      issues: [{ path: "/targets/candidate/rawCommand", code: "unknown-field" }],
    },
  });
});

test("rejects non-finite evaluation limits before replay", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumCases: Number.NaN },
  });

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-configuration",
      issues: [{ path: "/limits/maximumCases", code: "positive-integer" }],
    },
  });
});

test("rejects a non-finite absolute deadline before replay", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    deadline: Number.NaN,
  });

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-configuration",
      issues: [{ path: "/deadline", code: "finite-number" }],
    },
  });
});

test("stops when a target result exceeds the caller-tightened byte limit", async () => {
  let baselineRuns = 0;
  let candidateRuns = 0;
  const resultBytes = new TextEncoder().encode(JSON.stringify(invalidDiffResult)).byteLength;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        baselineRuns += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        candidateRuns += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumResultBytes: resultBytes - 1 },
  });

  assert.equal(baselineRuns, 1);
  assert.equal(candidateRuns, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [
        {
          path: "/limits/maximumResultBytes",
          code: "exceeded",
          expected: resultBytes - 1,
          actual: resultBytes,
        },
      ],
    },
  });
});

test("omits issue values above the caller-tightened diagnostic limit", async () => {
  const cancelledResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: { ok: false, error: { code: "cancelled", stage: "start" } },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => invalidDiffResult,
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => cancelledResult,
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumIssueValueCharacters: 1 },
  });

  assert.deepEqual(completePayload(result).cases[0]?.candidate, {
    status: "mismatched",
    issues: [{ path: "/protected/result", code: "mismatch" }],
  });
});

test("terminates when collected comparison issues exceed the configured cap", async () => {
  const cancelledResult = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: { ok: false, error: { code: "cancelled", stage: "start" } },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => cancelledResult,
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => cancelledResult,
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumIssues: 1 },
  });

  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [{ path: "/limits/maximumIssues", code: "exceeded", expected: 1, actual: 2 }],
    },
  });
});

test("bounds the final aggregated evaluation result", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });
  const completed = await comparer.compare([evaluationCase], context);
  const completedBytes = new TextEncoder().encode(JSON.stringify(completed)).byteLength;

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumResultBytes: completedBytes - 1 },
  });

  assert.equal(runs, 4);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [
        {
          path: "/limits/maximumResultBytes",
          code: "exceeded",
          expected: completedBytes - 1,
          actual: completedBytes,
        },
      ],
    },
  });
});

test("bounds findings returned by replay targets", async () => {
  const resultWithTwoFindings = {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject: evaluationCase.request.payload.subject,
        reviewer: "deterministic-security",
        summary:
          "2 findings across 1 changed file; coverage: complete; highest severity: critical.",
        risk: "critical",
        coverage,
        analyzers: [analyzer],
        diagnostics: [],
        findings: [unexpectedFinding, unexpectedFinding],
      },
    },
  } as const;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => invalidDiffResult,
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => resultWithTwoFindings,
    },
    clock: () => 0,
  });

  const result = await comparer.compare([evaluationCase], {
    ...context,
    limits: { ...context.limits, maximumFindings: 1 },
  });

  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "limit-exceeded",
      issues: [{ path: "/limits/maximumFindings", code: "exceeded", expected: 1, actual: 2 }],
    },
  });
});

test("honors an absolute deadline before invoking either target", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 10_000,
  });

  const result = await comparer.compare([evaluationCase], context);

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: { code: "deadline-exceeded" },
  });
});

test("rejects an empty dataset instead of reporting a vacuous pass", async () => {
  let runs = 0;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([], context);

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-dataset",
      issues: [{ path: "/cases", code: "min-items" }],
    },
  });
});

test("rejects a cyclic non-JSON dataset without throwing", async () => {
  let runs = 0;
  const cyclicCase: { self?: unknown } = {};
  cyclicCase.self = cyclicCase;
  const comparer = evaluationV1.createComparer({
    baseline: {
      descriptor: { name: "frozen-review", version: "1.0.0", profile: "f3-baseline" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    candidate: {
      descriptor: { name: "current-review", version: "1.0.0", profile: "f4-candidate" },
      run: async () => {
        runs += 1;
        return invalidDiffResult;
      },
    },
    clock: () => 0,
  });

  const result = await comparer.compare([cyclicCase], context);

  assert.equal(runs, 0);
  assert.deepEqual(result.payload, {
    ok: false,
    error: {
      code: "invalid-dataset",
      issues: [{ path: "/cases", code: "non-json" }],
    },
  });
});
