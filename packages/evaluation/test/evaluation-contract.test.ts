import assert from "node:assert/strict";
import test from "node:test";

import { evaluationV1 } from "../src/index.ts";

const skippedOutcome = {
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
} as const;

const validEvaluationCase = {
  kind: "eve-reviewer.evaluation-case",
  schemaVersion: 1,
  caseId: "invalid-diff",
  source: "synthetic-controlled",
  request: {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: { kind: "pull-request", repository: "example/repository", number: 7 },
      reviewer: "deterministic-security",
      diff: "diff --git a/src/value.ts b/src/value.ts\n",
      sources: { base: [], head: [] },
    },
  },
  baselineResult: {
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "invalid-diff", message: "The diff is invalid." },
    },
  },
  candidateOutcomes: [skippedOutcome],
  protected: {
    result: { ok: false, errorCode: "invalid-diff" },
    analyzers: [],
    findings: [],
  },
} as const;

test("rejects an unversioned evaluation case with a stable contract issue", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    caseId: "dynamic-eval-new-side",
    source: "synthetic-controlled",
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/schemaVersion", code: "required" }],
    },
  });
});

test("rejects an invalid frozen baseline result at its nested path", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "dynamic-eval-new-side",
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
    baselineResult: {},
    candidateOutcomes: [skippedOutcome],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [],
      findings: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/baselineResult", code: "required" }],
    },
  });
});

test("rejects an invalid review request before accepting the case", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "invalid-request",
    source: "synthetic-controlled",
    request: {},
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [skippedOutcome],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [],
      findings: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/request/kind", code: "required" }],
    },
  });
});

test("requires at least one literal candidate analyzer outcome", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "empty-outcomes",
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
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [],
      findings: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/candidateOutcomes", code: "minItems" }],
    },
  });
});

test("rejects an invalid candidate analyzer outcome at its array position", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "invalid-outcome",
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
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [{}],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [],
      findings: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/candidateOutcomes/0", code: "required" }],
    },
  });
});

test("rejects unknown fields in protected evaluation facts", () => {
  const decoded = evaluationV1.decodeCase({
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
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [skippedOutcome],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [],
      findings: [],
      rawSource: "must not be accepted",
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/protected/rawSource", code: "unknown-field" }],
    },
  });
});

test("runtime-validates protected analyzer identity", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "invalid-protected-analyzer",
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
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [skippedOutcome],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [
        {
          tool: "biome",
          version: "2.5.8",
          profile: "deterministic-security",
          rules: ["lint/security/noGlobalEval"],
          operationId: "must not be accepted",
        },
      ],
      findings: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/protected/analyzers/0/operationId", code: "unknown-field" }],
    },
  });
});

test("runtime-validates protected evidence-linked findings", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "invalid-protected-finding",
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
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [skippedOutcome],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      analyzers: [],
      findings: [
        {
          ruleId: "security/no-dynamic-eval",
          severity: "critical",
          location: { side: "new", path: "src/value.ts", line: 1 },
          evidence: "eval(input)",
          provenance: {
            tool: "biome",
            version: "2.5.8",
            ruleId: "lint/security/noGlobalEval",
          },
          rawOutput: "must not be accepted",
        },
      ],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/protected/findings/0/rawOutput", code: "unknown-field" }],
    },
  });
});

test("runtime-validates protected file classification and coverage", () => {
  const decoded = evaluationV1.decodeCase({
    kind: "eve-reviewer.evaluation-case",
    schemaVersion: 1,
    caseId: "invalid-protected-coverage",
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
    baselineResult: {
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: { code: "invalid-diff", message: "The diff is invalid." },
      },
    },
    candidateOutcomes: [skippedOutcome],
    protected: {
      result: { ok: false, errorCode: "invalid-diff" },
      coverage: {
        status: "no-coverage",
        files: [
          {
            oldPath: "src/value.ts",
            newPath: "src/value.ts",
            status: "modified",
            baseSource: "available",
            headSource: "available",
            analyses: [
              {
                analyzer: skippedOutcome.payload.analyzer,
                status: "skipped",
                reason: "source-unavailable",
                side: "new",
              },
            ],
            rawState: "must not be accepted",
          },
        ],
      },
      analyzers: [],
      findings: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-case",
      issues: [{ path: "/protected/coverage/files/0/rawState", code: "unknown-field" }],
    },
  });
});

test("decodes a validated case into an isolated snapshot", () => {
  const input = structuredClone(validEvaluationCase);
  const decoded = evaluationV1.decodeCase(input);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) {
    return;
  }

  (input.request.payload as { reviewer: string }).reviewer = "mutated-after-decode";

  assert.equal(decoded.value.request.payload.reviewer, "deterministic-security");
});

test("encodes a validated case as canonical compact JSON", () => {
  const encoded = evaluationV1.encodeCase({
    source: validEvaluationCase.source,
    protected: validEvaluationCase.protected,
    request: validEvaluationCase.request,
    kind: validEvaluationCase.kind,
    candidateOutcomes: validEvaluationCase.candidateOutcomes,
    caseId: validEvaluationCase.caseId,
    schemaVersion: validEvaluationCase.schemaVersion,
    baselineResult: validEvaluationCase.baselineResult,
  });

  assert.deepEqual(encoded, {
    ok: true,
    value:
      '{"baselineResult":{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"invalid-diff","message":"The diff is invalid."},"ok":false},"schemaVersion":1},"candidateOutcomes":[{"kind":"eve-reviewer.analyzer-outcome","payload":{"analyzer":{"profile":"deterministic-security","rules":["lint/security/noGlobalEval"],"tool":"biome","version":"2.5.8"},"files":[{"path":"src/value.ts","reason":"source-unavailable","side":"new","status":"skipped"}],"status":"skipped"},"schemaVersion":1}],"caseId":"invalid-diff","kind":"eve-reviewer.evaluation-case","protected":{"analyzers":[],"findings":[],"result":{"errorCode":"invalid-diff","ok":false}},"request":{"kind":"eve-reviewer.review-request","payload":{"diff":"diff --git a/src/value.ts b/src/value.ts\\n","reviewer":"deterministic-security","sources":{"base":[],"head":[]},"subject":{"kind":"pull-request","number":7,"repository":"example/repository"}},"schemaVersion":1},"schemaVersion":1,"source":"synthetic-controlled"}',
  });
});

test("distinguishes an unsupported evaluation result version", () => {
  const decoded = evaluationV1.decodeResult({
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 2,
    payload: { ok: false, error: { code: "cancelled" } },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "unsupported-schema-version",
      stage: "decode-result",
      issues: [{ path: "/schemaVersion", code: "unsupported" }],
    },
  });
});

test("rejects unknown fields in an evaluation result", () => {
  const decoded = evaluationV1.decodeResult({
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "cancelled", rawError: "must not be accepted" },
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-result",
      issues: [{ path: "/payload/error/rawError", code: "unknown-field" }],
    },
  });
});

test("encodes a validated terminal evaluation result as canonical compact JSON", () => {
  const encoded = evaluationV1.encodeResult({
    schemaVersion: 1,
    payload: { error: { code: "deadline-exceeded" }, ok: false },
    kind: "eve-reviewer.evaluation-result",
  });

  assert.deepEqual(encoded, {
    ok: true,
    value:
      '{"kind":"eve-reviewer.evaluation-result","payload":{"error":{"code":"deadline-exceeded"},"ok":false},"schemaVersion":1}',
  });
});

test("rejects non-JSON issue values instead of throwing during result encoding", () => {
  const encoded = evaluationV1.encodeResult({
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "invalid-dataset",
        issues: [{ path: "/cases", code: "invalid", expected: 1n }],
      },
    },
  });

  assert.deepEqual(encoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "encode-result",
      issues: [{ path: "/payload/error/issues/0/expected", code: "non-json" }],
    },
  });
});
