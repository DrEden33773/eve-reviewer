import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createModelReviewFailureOutcome,
  createModelReviewOutcome,
  createReviewUseCase,
  modelReviewCandidatesCodec,
  type ReviewRequestEnvelope,
} from "../src/index.ts";

function receiptFor(candidates: readonly unknown[]) {
  const bytes = JSON.stringify({
    kind: "eve-reviewer.model-review-candidates",
    schemaVersion: 1,
    payload: { candidates },
  });
  return {
    reviewRunId: "11111111-1111-4111-8111-111111111111",
    policyDigest: `sha256:${"a".repeat(64)}` as const,
    target: {
      targetId: "fixture.review",
      vendor: "fixture",
      modelId: "review-model",
      route: "direct",
      profileVersion: 1,
      certification: "certified",
    } as const,
    evidenceSetDigest: `sha256:${"b".repeat(64)}` as const,
    output: {
      contract: { id: "eve-reviewer.model-review-candidates", version: 1 } as const,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const,
      byteCount: Buffer.byteLength(bytes),
    },
    traceDigest: `sha256:${"c".repeat(64)}` as const,
    usage: { inputTokens: 21, outputTokens: 7, reasoningTokens: 0, turns: 1 },
  };
}

test("the model-review candidate codec rejects trusted fields and accepts one bounded changed-line candidate", () => {
  const candidate = {
    ruleId: "security/no-dynamic-eval",
    severity: "high",
    title: "Dynamic evaluation executes untrusted input",
    explanation: "The changed line evaluates a value that can be influenced by an external caller.",
    location: { side: "new", path: "src/evaluate.ts", line: 2 },
    fixGuidance: "Replace dynamic evaluation with an explicit operation map.",
    suggestedTests: "Pass an unknown operation name and assert rejection.",
    confidence: 0.9,
  } as const;
  const invalid = {
    kind: "eve-reviewer.model-review-candidates",
    schemaVersion: 1,
    payload: {
      candidates: [{ ...candidate, evidence: "model-authored evidence must not be trusted" }],
    },
  };

  assert.deepEqual(modelReviewCandidatesCodec.decode(invalid), {
    ok: false,
    issues: [{ path: "/payload/candidates/0/evidence", code: "unknown-field" }],
  });

  const valid = {
    kind: "eve-reviewer.model-review-candidates",
    schemaVersion: 1,
    payload: { candidates: [candidate] },
  } as const;
  assert.deepEqual(modelReviewCandidatesCodec.decode(valid), { ok: true, value: valid });
});

test("empty model candidates preserve deterministic coverage and model failure preserves partial facts", async () => {
  const request: ReviewRequestEnvelope = {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: { kind: "pull-request", repository: "example/repository", number: 7 },
      reviewer: "combined-review",
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
  };
  const run = receiptFor([]);
  const deterministic = {
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
  } as const;
  const empty = createModelReviewOutcome({
    request,
    run,
    envelope: {
      kind: "eve-reviewer.model-review-candidates",
      schemaVersion: 1,
      payload: { candidates: [] },
    },
  });
  assert.equal(empty.ok, true);
  if (!empty.ok) throw new Error("The empty model stage must be valid.");
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
  const successfulReview = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [deterministic, empty.value.outcome],
  });
  const success = await successfulReview.review(request, context);
  assert.equal(success.payload.ok, true);
  if (!success.payload.ok) throw new Error("The empty model stage must complete.");
  assert.equal(success.payload.report.coverage.status, "complete");
  assert.equal(success.payload.report.findings.length, 0);

  const failedReview = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [deterministic, createModelReviewFailureOutcome(request)],
  });
  const failed = await failedReview.review(request, context);
  assert.equal(failed.payload.ok, false);
  if (failed.payload.ok) throw new Error("The failed model stage must remain non-success.");
  assert.deepEqual(failed.payload.error, { code: "required-analyzer-failed", stage: "analyze" });
  if (!("partial" in failed.payload))
    throw new Error("The failed model stage must retain partial facts.");
  assert.equal(failed.payload.partial.coverage.status, "partial");
  assert.equal(failed.payload.partial.findings.length, 0);
  assert.deepEqual(failed.payload.partial.diagnostics, [
    {
      analyzer: {
        tool: "eve-model-review",
        version: "1",
        profile: "eve-model-review.v1",
        rules: ["eve-model-review.v1"],
      },
      code: "model-review-failed",
      message:
        "Model review did not complete; verified deterministic evidence is preserved in the failed review result.",
    },
  ]);
});

test("model review rejects legacy managed-session provenance before composition", () => {
  const result = createModelReviewOutcome({
    request: {
      kind: "eve-reviewer.review-request",
      schemaVersion: 1,
      payload: {
        subject: { kind: "pull-request", repository: "example/repository", number: 7 },
        reviewer: "combined-review",
        diff: [
          "diff --git a/src/value.ts b/src/value.ts",
          "new file mode 100644",
          "--- /dev/null",
          "+++ b/src/value.ts",
          "@@ -0,0 +1 @@",
          "+export const value = 2;",
          "",
        ].join("\n"),
        sources: {
          base: [],
          head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
        },
      },
    },
    envelope: {
      kind: "eve-reviewer.model-review-candidates",
      schemaVersion: 1,
      payload: { candidates: [] },
    },
    run: {
      agentId: "not-a-uuid",
      attemptId: "22222222-2222-4222-8222-222222222222",
      profile: {
        id: "reviewer.v1",
        version: 1,
        digest: `sha256:${"a".repeat(64)}`,
        selectedSkillsDigest:
          "sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      },
      target: {
        targetId: "fixture.review.direct",
        vendor: "fixture",
        modelId: "review-model",
        route: "direct",
        profileVersion: 1,
        certification: "certified",
      },
      transcript: {
        sessionId: "33333333-3333-4333-8333-333333333333",
        digest: `sha256:${"c".repeat(64)}`,
        throughSequence: 8,
      },
      usage: { inputTokens: 21, outputTokens: 7, reasoningTokens: 0, turns: 1 },
      cost: { status: "unavailable" },
    } as never,
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-model-run",
      message: "The model review returned invalid managed-run provenance.",
    },
  });
});

test("the existing review use case composes deterministic and model findings without deduplication", async () => {
  const request: ReviewRequestEnvelope = {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: { kind: "pull-request", repository: "example/repository", number: 7 },
      reviewer: "combined-review",
      diff: [
        "diff --git a/src/evaluate.ts b/src/evaluate.ts",
        "--- a/src/evaluate.ts",
        "+++ b/src/evaluate.ts",
        "@@ -1 +1 @@",
        "-export const evaluate = parse;",
        "+export const evaluate = eval;",
        "",
      ].join("\n"),
      sources: {
        base: [{ path: "src/evaluate.ts", content: "export const evaluate = parse;\n" }],
        head: [{ path: "src/evaluate.ts", content: "export const evaluate = eval;\n" }],
      },
    },
  };
  const duplicate = {
    ruleId: "security/no-dynamic-eval",
    severity: "high",
    title: "Dynamic evaluation executes untrusted input",
    explanation: "The changed line selects dynamic evaluation.",
    location: { side: "new", path: "src/evaluate.ts", line: 1 },
    fixGuidance: "Use an explicit operation map.",
    suggestedTests: "Reject an unknown operation.",
    confidence: 0.9,
  } as const;
  const model = createModelReviewOutcome({
    request,
    envelope: {
      kind: "eve-reviewer.model-review-candidates",
      schemaVersion: 1,
      payload: { candidates: [duplicate] },
    },
    run: receiptFor([duplicate]),
  });
  assert.equal(model.ok, true);
  if (!model.ok) throw new Error("The literal model outcome must be valid.");
  const deterministic = {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: [duplicate.ruleId],
      },
      status: "analyzed",
      files: [{ side: "new", path: "src/evaluate.ts", status: "analyzed" }],
      candidates: [
        {
          ...duplicate,
          provenance: { tool: "biome", version: "2.5.8", ruleId: duplicate.ruleId },
        },
      ],
    },
  } as const;
  const review = createReviewUseCase({
    clock: () => 0,
    analyze: async () => [deterministic, model.value.outcome],
  });
  const result = await review.review(request, {
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
  });
  assert.equal(result.payload.ok, true);
  if (!result.payload.ok) throw new Error("The combined literal review must succeed.");
  assert.equal(result.payload.report.coverage.status, "complete");
  assert.equal(result.payload.report.findings.length, 2);
  assert.deepEqual(
    result.payload.report.findings.map((finding) => finding.provenance.tool),
    ["biome", "eve-model-review"],
  );
  assert.deepEqual(
    result.payload.report.coverage.files[0]?.analyses.map((analysis) => analysis.analyzer.tool),
    ["biome", "eve-model-review"],
  );
});

test("model review attaches code-owned provenance and extracts only changed-line evidence", () => {
  const request: ReviewRequestEnvelope = {
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: { kind: "pull-request", repository: "example/repository", number: 7 },
      reviewer: "deterministic-security",
      diff: [
        "diff --git a/src/evaluate.ts b/src/evaluate.ts",
        "--- a/src/evaluate.ts",
        "+++ b/src/evaluate.ts",
        "@@ -1,2 +1,2 @@",
        " export const stable = true;",
        "-export const evaluate = parse;",
        "+export const evaluate = eval;",
        "",
      ].join("\n"),
      sources: {
        base: [
          {
            path: "src/evaluate.ts",
            content: "export const stable = true;\nexport const evaluate = parse;\n",
          },
        ],
        head: [
          {
            path: "src/evaluate.ts",
            content: "export const stable = true;\nexport const evaluate = eval;\n",
          },
        ],
      },
    },
  };
  const envelope = {
    kind: "eve-reviewer.model-review-candidates",
    schemaVersion: 1,
    payload: {
      candidates: [
        {
          ruleId: "security/no-dynamic-eval",
          severity: "high",
          title: "Dynamic evaluation executes untrusted input",
          explanation: "The changed line selects dynamic evaluation.",
          location: { side: "new", path: "src/evaluate.ts", line: 2 },
          fixGuidance: "Use an explicit operation map.",
          suggestedTests: "Reject an unknown operation.",
          confidence: 0.9,
        },
      ],
    },
  } as const;

  const run = receiptFor(envelope.payload.candidates);
  assert.deepEqual(createModelReviewOutcome({ request, envelope, run }), {
    ok: true,
    value: {
      recipe: { id: "eve-model-review.v1", version: 1 },
      run,
      outcome: {
        kind: "eve-reviewer.analyzer-outcome",
        schemaVersion: 1,
        payload: {
          analyzer: {
            tool: "eve-model-review",
            version: "1",
            profile: "eve-model-review.v1",
            rules: ["security/no-dynamic-eval"],
          },
          status: "analyzed",
          files: [{ side: "new", path: "src/evaluate.ts", status: "analyzed" }],
          candidates: [
            {
              ...envelope.payload.candidates[0],
              provenance: {
                tool: "eve-model-review",
                version: "1",
                ruleId: "security/no-dynamic-eval",
              },
            },
          ],
        },
      },
      findings: [
        {
          ...envelope.payload.candidates[0],
          provenance: {
            tool: "eve-model-review",
            version: "1",
            ruleId: "security/no-dynamic-eval",
          },
          evidence: "export const evaluate = eval;",
        },
      ],
    },
  });

  assert.deepEqual(
    createModelReviewOutcome({
      request,
      run: receiptFor([
        {
          ...envelope.payload.candidates[0],
          location: { side: "new", path: "src/evaluate.ts", line: 1 },
        },
      ]),
      envelope: {
        ...envelope,
        payload: {
          candidates: [
            {
              ...envelope.payload.candidates[0],
              location: { side: "new", path: "src/evaluate.ts", line: 1 },
            },
          ],
        },
      },
    }),
    {
      ok: false,
      error: {
        code: "invalid-model-evidence",
        message:
          "A model finding does not reference an available changed line in the captured review evidence.",
      },
    },
  );
});
