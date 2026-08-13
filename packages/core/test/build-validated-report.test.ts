import assert from "node:assert/strict";
import test from "node:test";

import { buildValidatedReport } from "../src/index.ts";

test("rejects a finding that does not reference an added line", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "diff --git a/src/config.ts b/src/config.ts",
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -1 +1 @@",
      "-const value = input;",
      "+const value = eval(input);",
      "",
    ].join("\n"),
    sources: [{ path: "src/config.ts", content: "const value = eval(input);" }],
    candidates: [
      {
        ruleId: "security/no-dynamic-eval",
        severity: "critical",
        title: "Dynamic code evaluation",
        explanation: "Untrusted input can execute as code.",
        path: "src/config.ts",
        line: 99,
        fixGuidance: "Replace eval with an explicit parser.",
        suggestedTests: "Exercise hostile and malformed input.",
        confidence: 0.95,
        provenance: {
          tool: "fixture-analyzer",
          version: "1.0.0",
          ruleId: "fixture/no-dynamic-eval",
        },
      },
    ],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-evidence-location",
      message:
        "Finding security/no-dynamic-eval references src/config.ts:99, which is not an added line.",
      finding: {
        ruleId: "security/no-dynamic-eval",
        path: "src/config.ts",
        line: 99,
      },
    },
  });
});

test("builds a normalized report for a finding on an added line", () => {
  const candidate = {
    ruleId: "security/no-dynamic-eval",
    severity: "critical" as const,
    title: "Dynamic code evaluation",
    explanation: "Untrusted input can execute as code.",
    path: "src/config.ts",
    line: 4,
    fixGuidance: "Replace eval with an explicit parser.",
    suggestedTests: "Exercise hostile and malformed input.",
    confidence: 0.95,
    provenance: {
      tool: "fixture-analyzer",
      version: "1.0.0",
      ruleId: "fixture/no-dynamic-eval",
    },
  };
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "diff --git a/src/config.ts b/src/config.ts",
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -2,3 +2,4 @@ export function parse(input: string) {",
      '   const mode = "strict";',
      "-  const value = input;",
      "+  const fallback = input;",
      "+  const value = eval(input);",
      "   return value;",
      "",
    ].join("\n"),
    sources: [
      {
        path: "src/config.ts",
        content: [
          "export function parse(input: string) {",
          '  const mode = "strict";',
          "  const fallback = input;",
          "  const value = eval(input);",
          "  return value;",
          "}",
        ].join("\n"),
      },
    ],
    candidates: [candidate],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 17,
      summary: "1 finding across 1 changed file; highest severity: critical.",
      risk: "critical",
      filesReviewed: ["src/config.ts"],
      reviewer: "deterministic-security",
      findings: [{ ...candidate, evidence: "  const value = eval(input);" }],
    },
  });
});

test("rejects source text that does not match the referenced added line", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: [{ path: "src/config.ts", content: "eval(userInput);" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "source-mismatch",
      message: "Source snapshot does not match the diff at src/config.ts:1.",
      source: { path: "src/config.ts", line: 1 },
    },
  });
});

test("rejects source text that does not match unchanged hunk context", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -1 +1,2 @@",
      " const mode = 'strict';",
      "+safe();",
      "",
    ].join("\n"),
    sources: [{ path: "src/config.ts", content: "const mode = 'loose';\nsafe();" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "source-mismatch",
      message: "Source snapshot does not match the diff at src/config.ts:1.",
      source: { path: "src/config.ts", line: 1 },
    },
  });
});

test("normalizes CRLF line endings without changing source evidence", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null\r", "+++ b/src/config.ts\r", "@@ -0,0 +1 @@\r", "+safe();\r", ""].join(
      "\n",
    ),
    sources: [{ path: "src/config.ts", content: "safe();\r\n" }],
    candidates: [],
  });

  assert.equal(result.ok, true);
});

test("rejects a changed path that escapes the source snapshot", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/../outside.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: [{ path: "../outside.ts", content: "safe();" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Malformed unified diff: changed paths must stay inside the source snapshot.",
    },
  });
});

test("rejects ambiguous cross-platform changed paths", () => {
  for (const path of ["src/../outside.ts", "C:\\outside.ts", "\\\\server\\share\\file.ts"]) {
    const result = buildValidatedReport({
      repository: "acme/widgets",
      pullRequest: 17,
      reviewer: "deterministic-security",
      diff: ["--- /dev/null", `+++ b/${path}`, "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
      sources: [{ path, content: "safe();" }],
      candidates: [],
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "invalid-diff");
    }
  }
});

test("rejects a diff-only report when post-change source is unavailable", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "source-unavailable",
      message: "Source snapshot is unavailable for src/config.ts:1.",
      source: { path: "src/config.ts", line: 1 },
    },
  });
});

test("rejects added lines beyond a hunk's declared range", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -1 +1 @@",
      "-safe();",
      "+safer();",
      "+eval(userInput);",
      "",
    ].join("\n"),
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Malformed unified diff: hunk line counts do not match its header.",
    },
  });
});

test("treats an increment expression as an added hunk line", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "diff --git a/src/counter.ts b/src/counter.ts",
      "--- a/src/counter.ts",
      "+++ b/src/counter.ts",
      "@@ -1 +1 @@",
      "-counter += 1;",
      "+++ counter;",
      "",
    ].join("\n"),
    sources: [{ path: "src/counter.ts", content: "++ counter;" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 17,
      summary: "0 findings across 1 changed file; highest severity: none.",
      risk: "none",
      filesReviewed: ["src/counter.ts"],
      reviewer: "deterministic-security",
      findings: [],
    },
  });
});

test("rejects a diff that exceeds the input byte limit", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: "x".repeat(1_000_001),
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Diff exceeds the 1000000-byte input limit.",
    },
  });
});

test("rejects a diff that exceeds the added-line limit", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "--- /dev/null",
      "+++ b/src/generated.ts",
      "@@ -0,0 +1,10001 @@",
      ...Array.from({ length: 10_001 }, () => "+a"),
      "",
    ].join("\n"),
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Diff exceeds the 10000-added-line limit.",
    },
  });
});

test("rejects hunk coordinates outside JavaScript's safe integer range", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -0,0 +9007199254740993 @@",
      "+safe();",
      "",
    ].join("\n"),
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Malformed unified diff: hunk header values must be safe integers.",
    },
  });
});

test("rejects a hunk range that crosses JavaScript's safe integer limit", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: [
      "--- /dev/null",
      "+++ b/src/config.ts",
      "@@ -0,0 +9007199254740991,3 @@",
      "+first();",
      "+second();",
      "+third();",
      "",
    ].join("\n"),
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Malformed unified diff: hunk ranges must use safe integers.",
    },
  });
});
