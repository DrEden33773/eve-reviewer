import assert from "node:assert/strict";
import test from "node:test";

import { reviewContractV1 } from "../src/index.ts";

test("rejects an unversioned review request with a stable contract issue", () => {
  const decoded = reviewContractV1.decodeRequest({
    kind: "eve-reviewer.review-request",
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
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-request",
      issues: [{ path: "/schemaVersion", code: "required" }],
    },
  });
});

test("distinguishes an unsupported review request version", () => {
  const decoded = reviewContractV1.decodeRequest({
    kind: "eve-reviewer.review-request",
    schemaVersion: 2,
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
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "unsupported-schema-version",
      stage: "decode-request",
      issues: [{ path: "/schemaVersion", code: "unsupported" }],
    },
  });
});

test("decodes a strict versioned pull-request review request", () => {
  const request = {
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
  } as const;

  assert.deepEqual(reviewContractV1.decodeRequest(request), {
    ok: true,
    value: request,
  });
});

test("rejects unknown fields inside a review request payload", () => {
  const decoded = reviewContractV1.decodeRequest({
    kind: "eve-reviewer.review-request",
    schemaVersion: 1,
    payload: {
      subject: {
        kind: "pull-request",
        repository: "example/repository",
        number: 7,
        operationId: "adam-operation-1",
      },
      reviewer: "deterministic-security",
      diff: "diff --git a/src/value.ts b/src/value.ts\n",
      sources: { base: [], head: [] },
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-request",
      issues: [{ path: "/payload/subject/operationId", code: "unknown-field" }],
    },
  });
});

test("rejects raw analyzer details with a stable outcome issue", () => {
  const decoded = reviewContractV1.decodeOutcome({
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
      rawOutput: "untrusted process output",
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-outcome",
      issues: [{ path: "/payload/rawOutput", code: "unknown-field" }],
    },
  });
});

test("encodes a validated result as canonical compact JSON", () => {
  const encoded = reviewContractV1.encodeResult({
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { stage: "start", code: "cancelled" },
    },
    kind: "eve-reviewer.review-result",
  });

  assert.deepEqual(encoded, {
    ok: true,
    value:
      '{"kind":"eve-reviewer.review-result","payload":{"error":{"code":"cancelled","stage":"start"},"ok":false},"schemaVersion":1}',
  });
});

test("distinguishes an unsupported review result version", () => {
  const decoded = reviewContractV1.decodeResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 2,
    payload: {
      ok: false,
      error: { code: "cancelled", stage: "start" },
    },
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

test("distinguishes an unsupported review result version during encoding", () => {
  const encoded = reviewContractV1.encodeResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 2,
    payload: {
      ok: false,
      error: { code: "cancelled", stage: "start" },
    },
  });

  assert.deepEqual(encoded, {
    ok: false,
    error: {
      code: "unsupported-schema-version",
      stage: "encode-result",
      issues: [{ path: "/schemaVersion", code: "unsupported" }],
    },
  });
});

test("distinguishes an unsupported analyzer outcome version", () => {
  const decoded = reviewContractV1.decodeOutcome({
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 2,
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
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "unsupported-schema-version",
      stage: "decode-outcome",
      issues: [{ path: "/schemaVersion", code: "unsupported" }],
    },
  });
});

test("decodes one analyzed outcome with analyzed and skipped file cells", () => {
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
      files: [
        { side: "new", path: "src/value.ts", status: "analyzed" },
        { side: "new", path: "README.md", status: "skipped", reason: "unsupported" },
      ],
      candidates: [],
    },
  } as const;

  assert.deepEqual(reviewContractV1.decodeOutcome(outcome), {
    ok: true,
    value: outcome,
  });
});

test("rejects an analyzed outcome that contains only skipped file cells", () => {
  const decoded = reviewContractV1.decodeOutcome({
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
      files: [{ side: "new", path: "README.md", status: "skipped", reason: "unsupported" }],
      candidates: [],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-outcome",
      issues: [{ path: "/payload/status", code: "mismatch" }],
    },
  });
});

test("decodes a bounded failed outcome diagnostic with limit and cleanup facts", () => {
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
      status: "failed",
      files: [{ side: "new", path: "src/value.ts", status: "failed" }],
      diagnostic: {
        code: "analyzer-limit-exceeded",
        message: "The Biome analyzer exceeded the configured report limit.",
        resource: "report",
        cleanupIncomplete: true,
      },
    },
  } as const;

  assert.deepEqual(reviewContractV1.decodeOutcome(outcome), {
    ok: true,
    value: outcome,
  });
});

test("rejects candidate provenance that does not match its analyzer descriptor", () => {
  const decoded = reviewContractV1.decodeOutcome({
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
      candidates: [
        {
          ruleId: "security/no-dynamic-eval",
          severity: "critical",
          title: "Dynamic code evaluation",
          explanation: "Code added by the change evaluates text as executable code.",
          location: { side: "new", path: "src/value.ts", line: 1 },
          fixGuidance: "Use a parser.",
          suggestedTests: "Exercise hostile input.",
          confidence: 0.95,
          provenance: {
            tool: "other-tool",
            version: "2.5.8",
            ruleId: "lint/security/noGlobalEval",
          },
        },
      ],
    },
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-outcome",
      issues: [{ path: "/payload/candidates/0/provenance/tool", code: "mismatch" }],
    },
  });
});

test("rejects a candidate outside its analyzer's analyzed file cells", () => {
  const decoded = reviewContractV1.decodeOutcome({
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
      files: [
        { side: "new", path: "src/value.ts", status: "analyzed" },
        { side: "new", path: "README.md", status: "skipped", reason: "unsupported" },
      ],
      candidates: [
        {
          ruleId: "security/no-dynamic-eval",
          severity: "critical",
          title: "Dynamic code evaluation",
          explanation: "Code added by the change evaluates text as executable code.",
          location: { side: "new", path: "README.md", line: 1 },
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
  });

  assert.deepEqual(decoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "decode-outcome",
      issues: [{ path: "/payload/candidates/0/location", code: "mismatch" }],
    },
  });
});

test("reports an unknown result field at its stable nested path", () => {
  const encoded = reviewContractV1.encodeResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "cancelled",
        stage: "start",
        message: "not part of the v1 terminal contract",
      },
    },
  });

  assert.deepEqual(encoded, {
    ok: false,
    error: {
      code: "invalid-contract",
      stage: "encode-result",
      issues: [{ path: "/payload/error/message", code: "unknown-field" }],
    },
  });
});
