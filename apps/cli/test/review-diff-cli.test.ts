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
  assert.equal(
    result.stdout,
    `${JSON.stringify(
      {
        repository: "acme/widgets",
        pullRequest: 17,
        summary: "2 findings across 2 changed files; highest severity: critical.",
        risk: "critical",
        filesReviewed: ["src/evaluate.tsx", "README.md"],
        reviewer: "deterministic-security",
        findings: [
          {
            ruleId: "security/no-dynamic-eval",
            severity: "critical",
            title: "Dynamic code evaluation",
            explanation: "Code added by the change evaluates text as executable code.",
            path: "src/evaluate.tsx",
            line: 22,
            evidence: `  const parsed = \`\${eval(userInput)}\`;`,
            fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
            suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
            confidence: 0.95,
            provenance: {
              tool: "biome",
              version: "2.5.8",
              ruleId: "lint/security/noGlobalEval",
            },
          },
          {
            ruleId: "security/no-dynamic-eval",
            severity: "critical",
            title: "Dynamic code evaluation",
            explanation: "Code added by the change evaluates text as executable code.",
            path: "src/evaluate.tsx",
            line: 23,
            evidence: "  const execute = eval(userInput);",
            fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
            suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
            confidence: 0.95,
            provenance: {
              tool: "biome",
              version: "2.5.8",
              ruleId: "lint/security/noGlobalEval",
            },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
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
    '{"code":"source-unavailable","message":"Syntax-aware review requires complete post-change source."}\n',
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
      '{"code":"invalid-diff","message":"Malformed unified diff: hunk line counts do not match its header."}\n',
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
      '{"code":"invalid-diff","message":"Diff exceeds the 1000000-byte input limit."}\n',
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
  assert.equal(result.stderr, '{"code":"invalid-diff","message":"Unable to read diff input."}\n');
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
      '{"code":"invalid-source","message":"Source path is outside the source root: linked.ts."}\n',
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
    assert.deepEqual(JSON.parse(result.stdout), {
      repository: "acme/widgets",
      pullRequest: 17,
      summary: "0 findings across 1 changed file; highest severity: none.",
      risk: "none",
      filesReviewed: ["example.ts"],
      reviewer: "deterministic-security",
      findings: [],
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
    assert.equal(
      result.stderr,
      '{"code":"invalid-analyzer-output","message":"Biome SARIF contains a non-review diagnostic."}\n',
    );
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
    assert.equal(
      result.stderr,
      '{"code":"invalid-analyzer-output","message":"Biome SARIF contains a non-review diagnostic."}\n',
    );
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
    const report = JSON.parse(result.stdout) as { findings: Array<Record<string, unknown>> };
    assert.deepEqual(report.findings, [
      {
        ruleId: "security/no-dynamic-eval",
        severity: "critical",
        title: "Dynamic code evaluation",
        explanation: "Code added by the change evaluates text as executable code.",
        path: "suppressed.ts",
        line: 2,
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

test("rejects a source snapshot with too many changed files", () => {
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
      '{"code":"invalid-source","message":"Source snapshot exceeds the 100-file limit."}\n',
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
      '{"code":"invalid-source","message":"Source snapshot exceeds the 5000000-byte aggregate limit."}\n',
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true });
  }
});
