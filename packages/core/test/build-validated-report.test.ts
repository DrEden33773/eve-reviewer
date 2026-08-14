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
    sources: {
      base: [],
      head: [{ path: "src/config.ts", content: "const value = eval(input);" }],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [
      {
        ruleId: "security/no-dynamic-eval",
        severity: "critical",
        title: "Dynamic code evaluation",
        explanation: "Untrusted input can execute as code.",
        location: { side: "new", path: "src/config.ts", line: 99 },
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
        "Finding security/no-dynamic-eval references new src/config.ts:99, which is not a changed line on that side.",
      finding: {
        ruleId: "security/no-dynamic-eval",
        location: { side: "new", path: "src/config.ts", line: 99 },
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
    location: { side: "new" as const, path: "src/config.ts", line: 4 },
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
    sources: {
      base: [
        {
          path: "src/config.ts",
          content: [
            "export function parse(input: string) {",
            '  const mode = "strict";',
            "  const value = input;",
            "  return value;",
            "}",
          ].join("\n"),
        },
      ],
      head: [
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
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [candidate],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 17,
      summary: "1 finding across 1 changed file; coverage: complete; highest severity: critical.",
      risk: "critical",
      coverage: {
        status: "complete",
        files: [
          {
            oldPath: "src/config.ts",
            newPath: "src/config.ts",
            status: "modified",
            baseSource: "available",
            headSource: "available",
            analysis: { status: "analyzed", side: "new" },
          },
        ],
      },
      reviewer: "deterministic-security",
      findings: [{ ...candidate, evidence: "  const value = eval(input);" }],
    },
  });
});

test("extracts old-side evidence from base source for a deleted line", () => {
  const candidate = {
    ruleId: "cleanup/unsafe-disposal",
    severity: "high" as const,
    title: "Unsafe disposal removed",
    explanation: "The deleted guard may expose an unsafe cleanup path.",
    location: { side: "old" as const, path: "src/resource.ts", line: 3 },
    fixGuidance: "Restore an equivalent guard.",
    suggestedTests: "Exercise disposal after partial initialization.",
    confidence: 0.9,
    provenance: {
      tool: "fixture-analyzer",
      version: "1.0.0",
      ruleId: "fixture/unsafe-disposal",
    },
  };
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 18,
    reviewer: "deletion-review",
    diff: [
      "diff --git a/src/resource.ts b/src/resource.ts",
      "deleted file mode 100644",
      "--- a/src/resource.ts",
      "+++ /dev/null",
      "@@ -3 +0,0 @@",
      "-if (ready) dispose();",
      "",
    ].join("\n"),
    sources: {
      base: [
        {
          path: "src/resource.ts",
          content: "const ready = true;\nprepare();\nif (ready) dispose();",
        },
      ],
      head: [],
    },
    analyzedFiles: [{ side: "old", path: "src/resource.ts" }],
    candidates: [candidate],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 18,
      summary: "1 finding across 1 changed file; coverage: complete; highest severity: high.",
      risk: "high",
      coverage: {
        status: "complete",
        files: [
          {
            oldPath: "src/resource.ts",
            newPath: null,
            status: "deleted",
            baseSource: "available",
            headSource: "not-applicable",
            analysis: { status: "analyzed", side: "old" },
          },
        ],
      },
      reviewer: "deletion-review",
      findings: [{ ...candidate, evidence: "if (ready) dispose();" }],
    },
  });
});

test("rejects source text that does not match the referenced added line", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: {
      base: [],
      head: [{ path: "src/config.ts", content: "eval(userInput);" }],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "source-mismatch",
      message: "Source snapshot does not match the diff at new src/config.ts:1.",
      source: { side: "new", path: "src/config.ts", line: 1 },
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
    sources: {
      base: [],
      head: [{ path: "src/config.ts", content: "const mode = 'loose';\nsafe();" }],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "source-mismatch",
      message: "Source snapshot does not match the diff at new src/config.ts:1.",
      source: { side: "new", path: "src/config.ts", line: 1 },
    },
  });
});

test("rejects duplicate paths in a source snapshot", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: {
      base: [],
      head: [
        { path: "src/config.ts", content: "safe();" },
        { path: "src/config.ts", content: "safe();" },
      ],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-source",
      message: "Head source snapshot contains duplicate path: src/config.ts.",
    },
  });
});

test("rejects a source path that contradicts the changed side", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: {
      base: [{ path: "src/config.ts", content: "ghost();" }],
      head: [{ path: "src/config.ts", content: "safe();" }],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-source",
      message: "Base source path is not present on the old side of the change: src/config.ts.",
    },
  });
});

test("rejects a source file that exceeds the byte limit", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: {
      base: [],
      head: [{ path: "src/config.ts", content: "a".repeat(1_000_001) }],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-source",
      message: "Head source file exceeds the 1000000-byte limit: src/config.ts.",
    },
  });
});

test("rejects a source snapshot that exceeds the file limit", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: Array.from({ length: 6 }, (_, index) =>
      ["--- /dev/null", `+++ b/file-${String(index)}.ts`, "@@ -0,0 +1 @@", "+safe();", ""].join(
        "\n",
      ),
    ).join(""),
    sources: {
      base: [],
      head: Array.from({ length: 101 }, (_, index) => ({
        path: `file-${String(index)}.ts`,
        content: index === 0 ? "safe();" : "",
      })),
    },
    analyzedFiles: [{ side: "new", path: "file-0.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-source",
      message: "Head source snapshot exceeds the 100-file limit.",
    },
  });
});

test("rejects a source snapshot that exceeds the aggregate byte limit", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: Array.from({ length: 6 }, (_, index) =>
      ["--- /dev/null", `+++ b/file-${String(index)}.ts`, "@@ -0,0 +1 @@", "+safe();", ""].join(
        "\n",
      ),
    ).join(""),
    sources: {
      base: [],
      head: Array.from({ length: 6 }, (_, index) => ({
        path: `file-${String(index)}.ts`,
        content: "a".repeat(900_000),
      })),
    },
    analyzedFiles: [{ side: "new", path: "file-0.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-source",
      message: "Head source snapshot exceeds the 5000000-byte aggregate limit.",
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
    sources: { base: [], head: [{ path: "src/config.ts", content: "safe();\r\n" }] },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
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
    sources: { base: [], head: [{ path: "../outside.ts", content: "safe();" }] },
    analyzedFiles: [{ side: "new", path: "../outside.ts" }],
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
      sources: { base: [], head: [{ path, content: "safe();" }] },
      analyzedFiles: [{ side: "new", path }],
      candidates: [],
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "invalid-diff");
    }
  }
});

test("reports no coverage when post-change source is unavailable", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: ["--- /dev/null", "+++ b/src/config.ts", "@@ -0,0 +1 @@", "+safe();", ""].join("\n"),
    sources: { base: [], head: [] },
    analyzedFiles: [],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 17,
      summary: "0 findings across 1 changed file; coverage: no-coverage; highest severity: none.",
      risk: "none",
      coverage: {
        status: "no-coverage",
        files: [
          {
            oldPath: null,
            newPath: "src/config.ts",
            status: "added",
            baseSource: "not-applicable",
            headSource: "unavailable",
            analysis: { status: "not-analyzed", reason: "source-unavailable" },
          },
        ],
      },
      reviewer: "deterministic-security",
      findings: [],
    },
  });
});

test("reports explicit no-coverage reasons for deletion, binary, and rename-only changes", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 19,
    reviewer: "deterministic-security",
    diff: [
      "diff --git a/src/obsolete.ts b/src/obsolete.ts",
      "deleted file mode 100644",
      "--- a/src/obsolete.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-obsolete();",
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1234567..89abcde 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
      'diff --git "a/docs/old name.md" "b/docs/new name.md"',
      "similarity index 100%",
      "rename from docs/old name.md",
      "rename to docs/new name.md",
      "",
    ].join("\n"),
    sources: {
      base: [
        { path: "src/obsolete.ts", content: "obsolete();" },
        { path: "docs/old name.md", content: "unchanged" },
      ],
      head: [{ path: "docs/new name.md", content: "unchanged" }],
    },
    analyzedFiles: [],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 19,
      summary: "0 findings across 3 changed files; coverage: no-coverage; highest severity: none.",
      risk: "none",
      coverage: {
        status: "no-coverage",
        files: [
          {
            oldPath: "src/obsolete.ts",
            newPath: null,
            status: "deleted",
            baseSource: "available",
            headSource: "not-applicable",
            analysis: { status: "not-analyzed", reason: "deleted" },
          },
          {
            oldPath: "assets/logo.png",
            newPath: "assets/logo.png",
            status: "binary",
            baseSource: "unavailable",
            headSource: "unavailable",
            analysis: { status: "not-analyzed", reason: "binary" },
          },
          {
            oldPath: "docs/old name.md",
            newPath: "docs/new name.md",
            status: "renamed",
            baseSource: "available",
            headSource: "available",
            analysis: { status: "not-analyzed", reason: "metadata-only" },
          },
        ],
      },
      reviewer: "deterministic-security",
      findings: [],
    },
  });
});

test("keeps an empty-file deletion distinct from metadata-only coverage", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 22,
    reviewer: "deterministic-security",
    diff: [
      "diff --git a/src/empty.ts b/src/empty.ts",
      "deleted file mode 100644",
      "index e69de29..0000000",
      "",
    ].join("\n"),
    sources: { base: [{ path: "src/empty.ts", content: "" }], head: [] },
    analyzedFiles: [],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 22,
      summary: "0 findings across 1 changed file; coverage: no-coverage; highest severity: none.",
      risk: "none",
      coverage: {
        status: "no-coverage",
        files: [
          {
            oldPath: "src/empty.ts",
            newPath: null,
            status: "deleted",
            baseSource: "available",
            headSource: "not-applicable",
            analysis: { status: "not-analyzed", reason: "deleted" },
          },
        ],
      },
      reviewer: "deterministic-security",
      findings: [],
    },
  });
});

test("reports partial coverage when only one changed file was analyzed", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 20,
    reviewer: "deterministic-security",
    diff: [
      "--- /dev/null",
      "+++ b/src/config.ts",
      "@@ -0,0 +1 @@",
      "+safe();",
      "--- /dev/null",
      "+++ b/README.md",
      "@@ -0,0 +1 @@",
      "+Documentation",
      "",
    ].join("\n"),
    sources: {
      base: [],
      head: [
        { path: "src/config.ts", content: "safe();" },
        { path: "README.md", content: "Documentation" },
      ],
    },
    analyzedFiles: [{ side: "new", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 20,
      summary: "0 findings across 2 changed files; coverage: partial; highest severity: none.",
      risk: "none",
      coverage: {
        status: "partial",
        files: [
          {
            oldPath: null,
            newPath: "src/config.ts",
            status: "added",
            baseSource: "not-applicable",
            headSource: "available",
            analysis: { status: "analyzed", side: "new" },
          },
          {
            oldPath: null,
            newPath: "README.md",
            status: "added",
            baseSource: "not-applicable",
            headSource: "available",
            analysis: { status: "not-analyzed", reason: "unsupported" },
          },
        ],
      },
      reviewer: "deterministic-security",
      findings: [],
    },
  });
});

test("reports unavailable base source for declared old-side analysis", () => {
  const result = buildValidatedReport({
    repository: "acme/widgets",
    pullRequest: 21,
    reviewer: "deletion-review",
    diff: [
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -1 +1 @@",
      "-oldValue();",
      "+newValue();",
      "",
    ].join("\n"),
    sources: {
      base: [],
      head: [{ path: "src/config.ts", content: "newValue();" }],
    },
    analyzedFiles: [{ side: "old", path: "src/config.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 21,
      summary: "0 findings across 1 changed file; coverage: no-coverage; highest severity: none.",
      risk: "none",
      coverage: {
        status: "no-coverage",
        files: [
          {
            oldPath: "src/config.ts",
            newPath: "src/config.ts",
            status: "modified",
            baseSource: "unavailable",
            headSource: "available",
            analysis: { status: "not-analyzed", reason: "source-unavailable" },
          },
        ],
      },
      reviewer: "deletion-review",
      findings: [],
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
    sources: { base: [], head: [] },
    analyzedFiles: [],
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
    sources: { base: [], head: [{ path: "src/counter.ts", content: "++ counter;" }] },
    analyzedFiles: [{ side: "new", path: "src/counter.ts" }],
    candidates: [],
  });

  assert.deepEqual(result, {
    ok: true,
    report: {
      repository: "acme/widgets",
      pullRequest: 17,
      summary: "0 findings across 1 changed file; coverage: complete; highest severity: none.",
      risk: "none",
      coverage: {
        status: "complete",
        files: [
          {
            oldPath: "src/counter.ts",
            newPath: "src/counter.ts",
            status: "modified",
            baseSource: "unavailable",
            headSource: "available",
            analysis: { status: "analyzed", side: "new" },
          },
        ],
      },
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
    sources: { base: [], head: [] },
    analyzedFiles: [],
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
    sources: { base: [], head: [] },
    analyzedFiles: [],
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
    sources: { base: [], head: [] },
    analyzedFiles: [],
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
    sources: { base: [], head: [] },
    analyzedFiles: [],
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
