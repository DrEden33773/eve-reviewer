import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { reviewContractV1 } from "@eve-reviewer/core";

function canonicalResult(value: unknown): string {
  const encoded = reviewContractV1.encodeResult(value);
  assert.equal(encoded.ok, true);
  assert.ok("value" in encoded);
  return `${encoded.value}\n`;
}

function canonicalFailure(error: object): string {
  return canonicalResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: { ok: false, error },
  });
}

test("prints a stable evidence-linked report for a diff fixture", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const fixturePath = fileURLToPath(
    new URL("../../../test/fixtures/dynamic-eval.diff", import.meta.url),
  );
  const sourceRoot = fileURLToPath(new URL("../../../test/fixtures/source", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--repository",
      "acme/widgets",
      "--pull-request",
      "17",
      "--source-root",
      sourceRoot,
      fixturePath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const analyzer = {
    tool: "biome",
    version: "2.5.8",
    profile: "deterministic-security",
    rules: ["lint/security/noGlobalEval"],
  };
  const expected = reviewContractV1.encodeResult({
    kind: "eve-reviewer.review-result",
    schemaVersion: 1,
    payload: {
      ok: true,
      report: {
        subject: {
          kind: "pull-request",
          repository: "acme/widgets",
          number: 17,
        },
        reviewer: "deterministic-security",
        summary:
          "2 findings across 2 changed files; coverage: partial; highest severity: critical.",
        risk: "critical",
        coverage: {
          status: "partial",
          files: [
            {
              oldPath: "src/evaluate.tsx",
              newPath: "src/evaluate.tsx",
              status: "modified",
              baseSource: "unavailable",
              headSource: "available",
              analyses: [{ analyzer, status: "analyzed", side: "new" }],
            },
            {
              oldPath: "README.md",
              newPath: "README.md",
              status: "modified",
              baseSource: "unavailable",
              headSource: "available",
              analyses: [{ analyzer, status: "skipped", reason: "unsupported", side: "new" }],
            },
          ],
        },
        analyzers: [analyzer],
        diagnostics: [],
        findings: [
          {
            ruleId: "security/no-dynamic-eval",
            severity: "critical",
            title: "Dynamic code evaluation",
            explanation: "Code added by the change evaluates text as executable code.",
            location: { side: "new", path: "src/evaluate.tsx", line: 22 },
            fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
            suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
            confidence: 0.95,
            provenance: {
              tool: "biome",
              version: "2.5.8",
              ruleId: "lint/security/noGlobalEval",
            },
            evidence: `  const parsed = \`\${eval(userInput)}\`;`,
          },
          {
            ruleId: "security/no-dynamic-eval",
            severity: "critical",
            title: "Dynamic code evaluation",
            explanation: "Code added by the change evaluates text as executable code.",
            location: { side: "new", path: "src/evaluate.tsx", line: 23 },
            fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
            suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
            confidence: 0.95,
            provenance: {
              tool: "biome",
              version: "2.5.8",
              ruleId: "lint/security/noGlobalEval",
            },
            evidence: "  const execute = eval(userInput);",
          },
        ],
      },
    },
  });
  assert.equal(expected.ok, true);
  assert.ok("value" in expected);
  assert.equal(result.stdout, `${expected.value}\n`);
});

test("reports stable usage when required arguments are missing", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const result = spawnSync(process.execPath, [cliPath], { encoding: "utf8" });

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "Usage: eve-reviewer --repository <owner/name> --pull-request <number> [--source-root <directory>] <diff-file>\n",
  );
});

test("returns a typed source-unavailable result for a valid diff-only request", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const fixturePath = fileURLToPath(
    new URL("../../../test/fixtures/dynamic-eval.diff", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [cliPath, "--repository", "acme/widgets", "--pull-request", "17", fixturePath],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    canonicalResult({
      kind: "eve-reviewer.review-result",
      schemaVersion: 1,
      payload: {
        ok: false,
        error: {
          code: "source-unavailable",
          message: "Syntax-aware review requires complete post-change source.",
        },
      },
    }),
  );
});

test("validates the diff before returning source-unavailable in diff-only mode", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const diffPath = join(temporaryDirectory, "invalid.diff");

  try {
    writeFileSync(
      diffPath,
      ["--- /dev/null", "+++ b/example.ts", "@@ -0,0 +1 @@", "+safe();", "+extra();", ""].join(
        "\n",
      ),
    );
    const result = spawnSync(
      process.execPath,
      [cliPath, "--repository", "acme/widgets", "--pull-request", "17", diffPath],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      canonicalFailure({
        code: "invalid-diff",
        message: "Malformed unified diff: hunk line counts do not match its header.",
      }),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("rejects a non-numeric pull-request argument", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const fixturePath = fileURLToPath(
    new URL("../../../test/fixtures/dynamic-eval.diff", import.meta.url),
  );
  const sourceRoot = fileURLToPath(new URL("../../../test/fixtures/source", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--repository",
      "acme/widgets",
      "--pull-request",
      "not-a-number",
      "--source-root",
      sourceRoot,
      fixturePath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Pull request must be a positive integer.\n");
});

test("rejects a repository argument without owner and name", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const fixturePath = fileURLToPath(
    new URL("../../../test/fixtures/dynamic-eval.diff", import.meta.url),
  );
  const sourceRoot = fileURLToPath(new URL("../../../test/fixtures/source", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--repository",
      "widgets",
      "--pull-request",
      "17",
      "--source-root",
      sourceRoot,
      fixturePath,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Repository must use owner/name format.\n");
});

test("rejects an oversized diff before reading its contents", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const oversizedPath = join(temporaryDirectory, "oversized.diff");
  const sourceRoot = fileURLToPath(new URL("../../../test/fixtures/source", import.meta.url));

  try {
    writeFileSync(oversizedPath, "");
    truncateSync(oversizedPath, 1_000_001);
    chmodSync(oversizedPath, 0o000);
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        oversizedPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      canonicalFailure({
        code: "invalid-diff",
        message: "Diff exceeds the 1000000-byte input limit.",
      }),
    );
  } finally {
    chmodSync(oversizedPath, 0o600);
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("returns a typed error when the diff file cannot be read", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const sourceRoot = fileURLToPath(new URL("../../../test/fixtures/source", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "--repository",
      "acme/widgets",
      "--pull-request",
      "17",
      "--source-root",
      sourceRoot,
      "/path/that/does/not/exist.diff",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    canonicalFailure({ code: "invalid-diff", message: "Unable to read diff input." }),
  );
});

test("rejects a source path that escapes the source root through a symbolic link", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const outsidePath = join(temporaryDirectory, "outside.ts");
  const linkedPath = join(sourceRoot, "linked.ts");
  const diffPath = join(temporaryDirectory, "change.diff");

  try {
    mkdirSync(sourceRoot);
    writeFileSync(outsidePath, "eval(userInput);\n");
    symlinkSync(outsidePath, linkedPath);
    writeFileSync(
      diffPath,
      ["--- /dev/null", "+++ b/linked.ts", "@@ -0,0 +1 @@", "+eval(userInput);", ""].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      canonicalFailure({
        code: "invalid-source",
        message: "Source path is outside the source root: linked.ts.",
      }),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("ignores analyzer diagnostics outside the changed lines", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const sourcePath = join(sourceRoot, "example.ts");
  const diffPath = join(temporaryDirectory, "change.diff");

  try {
    mkdirSync(sourceRoot);
    writeFileSync(sourcePath, "eval(existingInput);\nconst safe = true;\n");
    writeFileSync(
      diffPath,
      [
        "--- a/example.ts",
        "+++ b/example.ts",
        "@@ -1 +1,2 @@",
        " eval(existingInput);",
        "+const safe = true;",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as {
      payload: { report: { coverage: unknown; findings: unknown[] } };
    };
    assert.equal(canonicalResult(envelope), result.stdout);
    assert.deepEqual(envelope.payload.report.findings, []);
    assert.deepEqual(envelope.payload.report.coverage, {
      status: "complete",
      files: [
        {
          oldPath: "example.ts",
          newPath: "example.ts",
          status: "modified",
          baseSource: "unavailable",
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
    });
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("rejects source whose eval binding makes the analyzer result ambiguous", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const sourcePath = join(sourceRoot, "shadowed.js");
  const diffPath = join(temporaryDirectory, "change.diff");

  try {
    mkdirSync(sourceRoot);
    writeFileSync(sourcePath, "function run(eval) { return eval(userInput); }\n");
    writeFileSync(
      diffPath,
      [
        "--- /dev/null",
        "+++ b/shadowed.js",
        "@@ -0,0 +1 @@",
        "+function run(eval) { return eval(userInput); }",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const envelope = JSON.parse(result.stderr) as {
      payload: {
        error: unknown;
        partial: { coverage: { status: string }; diagnostics: unknown[] };
      };
    };
    assert.equal(canonicalResult(envelope), result.stderr);
    assert.deepEqual(envelope.payload.error, {
      code: "required-analyzer-failed",
      stage: "analyze",
    });
    assert.equal(envelope.payload.partial.coverage.status, "no-coverage");
    assert.deepEqual(envelope.payload.partial.diagnostics, [
      {
        analyzer: {
          tool: "biome",
          version: "2.5.8",
          profile: "deterministic-security",
          rules: ["lint/security/noGlobalEval"],
        },
        code: "analyzer-diagnostic",
        message: "Biome reported a diagnostic outside the deterministic review profile.",
      },
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("rejects source that the syntax-aware analyzer cannot parse", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const sourcePath = join(sourceRoot, "invalid.ts");
  const diffPath = join(temporaryDirectory, "change.diff");

  try {
    mkdirSync(sourceRoot);
    writeFileSync(sourcePath, "const value = ;\n");
    writeFileSync(
      diffPath,
      ["--- /dev/null", "+++ b/invalid.ts", "@@ -0,0 +1 @@", "+const value = ;", ""].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const envelope = JSON.parse(result.stderr) as {
      payload: { error: unknown; partial: { diagnostics: unknown[] } };
    };
    assert.equal(canonicalResult(envelope), result.stderr);
    assert.deepEqual(envelope.payload.error, {
      code: "required-analyzer-failed",
      stage: "analyze",
    });
    assert.deepEqual(envelope.payload.partial.diagnostics, [
      {
        analyzer: {
          tool: "biome",
          version: "2.5.8",
          profile: "deterministic-security",
          rules: ["lint/security/noGlobalEval"],
        },
        code: "analyzer-diagnostic",
        message: "Biome reported a diagnostic outside the deterministic review profile.",
      },
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("does not let source suppression comments hide a finding", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const sourcePath = join(sourceRoot, "suppressed.ts");
  const diffPath = join(temporaryDirectory, "change.diff");

  try {
    mkdirSync(sourceRoot);
    writeFileSync(
      sourcePath,
      "// biome-ignore lint/security/noGlobalEval: hide the finding\neval(userInput);\n",
    );
    writeFileSync(
      diffPath,
      [
        "--- /dev/null",
        "+++ b/suppressed.ts",
        "@@ -0,0 +1,2 @@",
        "+// biome-ignore lint/security/noGlobalEval: hide the finding",
        "+eval(userInput);",
        "",
      ].join("\n"),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    const envelope = JSON.parse(result.stdout) as {
      payload: { report: { findings: Array<Record<string, unknown>> } };
    };
    assert.equal(canonicalResult(envelope), result.stdout);
    assert.deepEqual(envelope.payload.report.findings, [
      {
        ruleId: "security/no-dynamic-eval",
        severity: "critical",
        title: "Dynamic code evaluation",
        explanation: "Code added by the change evaluates text as executable code.",
        location: { side: "new", path: "suppressed.ts", line: 2 },
        evidence: "eval(userInput);",
        fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
        suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
        confidence: 0.95,
        provenance: {
          tool: "biome",
          version: "2.5.8",
          ruleId: "lint/security/noGlobalEval",
        },
      },
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("rejects a diff with too many changed files", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const diffPath = join(temporaryDirectory, "change.diff");

  try {
    mkdirSync(sourceRoot);
    writeFileSync(
      diffPath,
      Array.from({ length: 101 }, (_, index) =>
        ["--- /dev/null", `+++ b/file-${String(index)}.md`, "@@ -0,0 +1 @@", "+safe", ""].join(
          "\n",
        ),
      ).join(""),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      canonicalFailure({
        code: "invalid-diff",
        message: "Diff exceeds the 100-changed-file limit.",
      }),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});

test("rejects a source snapshot whose aggregate size is too large", () => {
  const cliPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "eve-review-cli-"));
  const sourceRoot = join(temporaryDirectory, "source");
  const diffPath = join(temporaryDirectory, "change.diff");
  const files = Array.from({ length: 6 }, (_, index) => `file-${String(index)}.md`);

  try {
    mkdirSync(sourceRoot);
    for (const path of files) {
      writeFileSync(join(sourceRoot, path), `${"a".repeat(899_989)}\ntail\nsafe\n`);
    }
    writeFileSync(
      diffPath,
      files
        .map((path) =>
          ["--- a/placeholder.md", `+++ b/${path}`, "@@ -2 +2,2 @@", " tail", "+safe", ""].join(
            "\n",
          ),
        )
        .join(""),
    );
    const result = spawnSync(
      process.execPath,
      [
        cliPath,
        "--repository",
        "acme/widgets",
        "--pull-request",
        "17",
        "--source-root",
        sourceRoot,
        diffPath,
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      canonicalFailure({
        code: "invalid-source",
        message: "Source snapshot exceeds the 5000000-byte aggregate limit.",
      }),
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});
