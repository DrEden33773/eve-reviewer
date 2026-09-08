import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createModelReviewOutcome,
  type ModelReviewCandidate,
  type ModelReviewRunProvenance,
  modelReviewCandidatesCodec,
  type ReviewRequestEnvelope,
} from "../src/index.ts";

const request: ReviewRequestEnvelope = {
  kind: "eve-reviewer.review-request",
  schemaVersion: 1,
  payload: {
    subject: { kind: "pull-request", repository: "example/repository", number: 7 },
    reviewer: "combined-review",
    diff: "diff --git a/value.ts b/value.ts\n--- a/value.ts\n+++ b/value.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n",
    sources: {
      base: [{ path: "value.ts", content: "export const value = 1;\n" }],
      head: [{ path: "value.ts", content: "export const value = 2;\n" }],
    },
  },
};
const envelope = {
  kind: "eve-reviewer.model-review-candidates",
  schemaVersion: 1,
  payload: { candidates: [] },
} as const;
const run = {
  reviewRunId: "11111111-1111-4111-8111-111111111111",
  policyDigest: `sha256:${"a".repeat(64)}`,
  target: {
    targetId: "fixture.review",
    vendor: "fixture",
    modelId: "review-model",
    route: "direct",
    profileVersion: 1,
    certification: "certified",
  },
  evidenceSetDigest: `sha256:${"b".repeat(64)}`,
  output: {
    contract: { id: "eve-reviewer.model-review-candidates", version: 1 },
    digest: "sha256:a475b4791d2cd97292f733c4c257820210c90a17b19643da8021fbf87d889e1f",
    byteCount: 93,
  },
  traceDigest: `sha256:${"c".repeat(64)}`,
  usage: { inputTokens: 40_000, outputTokens: 7, reasoningTokens: 0, turns: 5 },
} as const;

test("managed-review receipt composes verified output without legacy identities or budget ceilings", () => {
  const result = createModelReviewOutcome({ request, envelope, run });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected receipt acceptance");
  assert.deepEqual(result.value.run, run);
  assert.equal(result.value.outcome.payload.status, "analyzed");
});

for (const [name, output] of [
  ["digest", { ...run.output, digest: `sha256:${"d".repeat(64)}` }],
  ["size", { ...run.output, byteCount: 94 }],
  ["codec", { ...run.output, contract: { id: "unrelated", version: 1 } }],
] as const) {
  test(`managed-review rejects output ${name} mismatches`, () => {
    const result = createModelReviewOutcome({
      request,
      envelope,
      run: { ...run, output } as never,
    });
    assert.equal(result.ok, false);
  });
}

test("managed-review accepts exactly one MiB of validated candidates and rejects overflow", () => {
  const candidates: { -readonly [K in keyof ModelReviewCandidate]: ModelReviewCandidate[K] }[] =
    Array.from({ length: 100 }, () => ({
      ruleId: "example",
      severity: "low",
      title: "Changed value",
      explanation: "x".repeat(8_192),
      location: { side: "new", path: "value.ts", line: 1 },
      fixGuidance: "",
      suggestedTests: "",
      confidence: 0.5,
    }));
  const large = { ...envelope, payload: { candidates } };
  let remaining = 1_048_576 - Buffer.byteLength(JSON.stringify(large));
  for (const candidate of candidates) {
    const count = Math.min(remaining, 8_192);
    candidate.fixGuidance = "x".repeat(count);
    remaining -= count;
  }
  assert.equal(remaining, 0);
  const bytes = JSON.stringify(large);
  assert.equal(Buffer.byteLength(bytes), 1_048_576);
  const receipt: ModelReviewRunProvenance = {
    ...run,
    output: {
      ...run.output,
      byteCount: 1_048_576,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    },
  };
  const result = createModelReviewOutcome({
    request,
    envelope: large,
    run: receipt,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("Expected complete output");
  assert.equal(result.value.findings.length, 100);
  const last = candidates[99];
  assert.ok(last);
  last.suggestedTests = "x";
  assert.deepEqual(modelReviewCandidatesCodec.decode(large), {
    ok: false,
    issues: [{ path: "/", code: "max-bytes" }],
  });
  assert.equal(createModelReviewOutcome({ request, envelope: large, run: receipt }).ok, false);
});

for (const [name, fields] of [
  ["legacy identity", { agentId: "11111111-1111-4111-8111-111111111111" }],
  ["negative usage", { usage: { ...run.usage, inputTokens: -1 } }],
  ["invalid policy digest", { policyDigest: "sha256:bad" }],
  ["invalid review identity", { reviewRunId: "not-a-uuid" }],
] as const) {
  test(`managed-review rejects ${name}`, () => {
    assert.equal(
      createModelReviewOutcome({ request, envelope, run: { ...run, ...fields } as never }).ok,
      false,
    );
  });
}

test("managed-review accepts UUIDv7 identities admitted by the public receipt codec", () => {
  assert.equal(
    createModelReviewOutcome({
      request,
      envelope,
      run: { ...run, reviewRunId: "019a7777-1111-7111-8111-111111111111" },
    }).ok,
    true,
  );
});
