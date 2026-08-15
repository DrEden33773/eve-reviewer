import assert from "node:assert/strict";
import test from "node:test";

import {
  type AnalyzerContext,
  type AnalyzerExecutionInput,
  createDeterministicReviewer,
  type DeterministicReviewInput,
} from "../src/index.ts";

function deterministicInput(
  headContent = "const value = normalize(input);",
): DeterministicReviewInput {
  return {
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: {
      files: [
        {
          oldPath: "src/config.ts",
          newPath: "src/config.ts",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "src/config.ts", line: 1 },
              content: "const value = input;",
              changed: true,
            },
            {
              location: { side: "new", path: "src/config.ts", line: 1 },
              content: headContent,
              changed: true,
            },
          ],
        },
      ],
    },
    sources: {
      base: [{ path: "src/config.ts", content: "const value = input;" }],
      head: [{ path: "src/config.ts", content: headContent }],
    },
  };
}

function analyzerContext(signal = new AbortController().signal): AnalyzerContext {
  return {
    signal,
    deadline: 6_000,
    limits: {
      maximumSourceFiles: 100,
      maximumSourceFileBytes: 1_000_000,
      maximumSnapshotBytes: 5_000_000,
      maximumStdoutBytes: 1_000_000,
      maximumStderrBytes: 1_000_000,
      maximumReportBytes: 10_000_000,
      terminationGraceMilliseconds: 250,
    },
  };
}

test("returns a complete zero-finding report with analyzer provenance", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
    }),
  });
  const result = await reviewer.review(deterministicInput(), analyzerContext());

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
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
      findings: [],
    },
  });
});

test("keeps the pinned analyzer rules isolated from caller mutation", async () => {
  const executionRules: string[][] = [];
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async (input) => {
      executionRules.push([...input.rules]);
      return {
        ok: true as const,
        version: "2.5.8",
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      };
    },
  });

  const first = await reviewer.review(deterministicInput(), analyzerContext());
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  first.report.analyzer.rules.push("caller/mutation");

  const second = await reviewer.review(deterministicInput(), analyzerContext());

  assert.equal(second.ok, true);
  if (!second.ok) {
    return;
  }
  assert.deepEqual(second.report.analyzer.rules, ["lint/security/noGlobalEval"]);
  assert.deepEqual(executionRules, [
    ["lint/security/noGlobalEval"],
    ["lint/security/noGlobalEval"],
  ]);
});

test("maps a Biome diagnostic on a changed line into source-owned evidence", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 1,
      stdout: "",
      stderr: "",
      artifacts: [{ uri: "file:///snapshot/src/config.ts", path: "src/config.ts" }],
      report: JSON.stringify({
        version: "2.1.0",
        runs: [
          {
            results: [
              {
                ruleId: "lint/security/noGlobalEval",
                locations: [
                  {
                    physicalLocation: {
                      artifactLocation: { uri: "file:///snapshot/src/config.ts" },
                      region: { startLine: 1 },
                    },
                  },
                ],
              },
            ],
          },
        ],
      }),
    }),
  });

  const result = await reviewer.review(
    deterministicInput("const value = eval(input);"),
    analyzerContext(),
  );

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
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
      findings: [
        {
          ruleId: "security/no-dynamic-eval",
          severity: "critical",
          title: "Dynamic code evaluation",
          explanation: "Code added by the change evaluates text as executable code.",
          location: { side: "new", path: "src/config.ts", line: 1 },
          fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
          suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
          confidence: 0.95,
          provenance: {
            tool: "biome",
            version: "2.5.8",
            ruleId: "lint/security/noGlobalEval",
          },
          evidence: "const value = eval(input);",
        },
      ],
    },
  });
});

test("returns a typed analyzer diagnostic instead of an empty success", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 1,
      stdout: "",
      stderr: "",
      report: JSON.stringify({
        version: "2.1.0",
        runs: [{ results: [{ ruleId: "parse/noInvalidSyntax" }] }],
      }),
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-diagnostic",
      stage: "analyze",
      message:
        "Biome reported diagnostic parse/noInvalidSyntax outside the deterministic review profile.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns a typed failure when the analyzer cannot start", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "start" as const,
      version: "2.5.8",
      message: "spawn /private/tmp/eve-biome ENOENT",
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-start-failed",
      stage: "start",
      message: "Unable to start the Biome analyzer.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns a typed failure when the analyzer exits abnormally", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "execution" as const,
      version: "2.5.8",
      exitCode: 2,
      message: "Biome exited with status 2 and private stderr.",
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-execution-failed",
      stage: "execute",
      message: "The Biome analyzer did not complete successfully.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns a typed failure for malformed analyzer output", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: "{",
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-analyzer-output",
      stage: "validate-output",
      message: "Biome did not produce valid SARIF.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns cancellation before starting external analysis", async () => {
  const controller = new AbortController();
  controller.abort();
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => {
      throw new Error("external analysis must not start after cancellation");
    },
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext(controller.signal));

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "cancelled",
      stage: "start",
      message: "The deterministic review was cancelled before analysis started.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns deadline expiry before starting external analysis", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 6_000,
    executeAnalyzer: async () => {
      throw new Error("external analysis must not start after the deadline");
    },
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "deadline-exceeded",
      stage: "start",
      message: "The deterministic review deadline elapsed before analysis started.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns cancellation after running analysis has cleaned up", async () => {
  const controller = new AbortController();
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async (_input, context) =>
      await new Promise((resolve) => {
        context.signal.addEventListener(
          "abort",
          () => {
            resolve({
              ok: false as const,
              failure: "cancelled" as const,
              version: "2.5.8",
            });
          },
          { once: true },
        );
      }),
  });

  const pending = reviewer.review(deterministicInput(), analyzerContext(controller.signal));
  controller.abort();
  const result = await pending;

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "cancelled",
      stage: "execute",
      message: "The deterministic review was cancelled during analysis.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns deadline expiry after running analysis has cleaned up", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "deadline" as const,
      version: "2.5.8",
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "deadline-exceeded",
      stage: "execute",
      message: "The deterministic review deadline elapsed during analysis.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("preserves cancellation when cleanup remains incomplete", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "cancelled" as const,
      version: "2.5.8",
      cleanupIncomplete: true as const,
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "cancelled",
      stage: "execute",
      message: "The deterministic review was cancelled during analysis.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
      cleanupIncomplete: true,
    },
  });
});

test("preserves deadline expiry when cleanup remains incomplete", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "deadline" as const,
      version: "2.5.8",
      cleanupIncomplete: true as const,
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "deadline-exceeded",
      stage: "execute",
      message: "The deterministic review deadline elapsed during analysis.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
      cleanupIncomplete: true,
    },
  });
});

test("returns cleanup failure when otherwise successful analysis cannot clean up", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "cleanup" as const,
      version: "2.5.8",
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-cleanup-failed",
      stage: "cleanup",
      message: "The Biome analyzer completed, but its temporary resources could not be cleaned up.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("rejects a successful analyzer result with incomplete cleanup", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      cleanupIncomplete: true as const,
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-cleanup-failed",
      stage: "cleanup",
      message: "The Biome analyzer completed, but its temporary resources could not be cleaned up.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns a typed analyzer limit failure with the exceeded resource", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: false as const,
      failure: "limit" as const,
      resource: "report" as const,
      version: "2.5.8",
      cleanupIncomplete: true as const,
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-limit-exceeded",
      stage: "execute",
      resource: "report",
      message: "The Biome analyzer exceeded the configured report limit.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
      cleanupIncomplete: true,
    },
  });
});

test("rejects source input against a caller-tightened file limit before analysis", async () => {
  let executions = 0;
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => {
      executions += 1;
      return {
        ok: true as const,
        version: "2.5.8",
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      };
    },
  });
  const context = analyzerContext();
  context.limits.maximumSourceFileBytes = 8;

  const result = await reviewer.review(deterministicInput(), context);

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-source",
      message: "Base source file exceeds the 8-byte limit: src/config.ts.",
    },
  });
  assert.equal(executions, 0);
});

test("returns a typed failure for structurally invalid SARIF", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: "not-an-array" }),
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-analyzer-output",
      stage: "validate-output",
      message: "The Biome analyzer returned invalid SARIF output.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns a typed failure for non-object SARIF", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: "null",
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-analyzer-output",
      stage: "validate-output",
      message: "The Biome analyzer returned invalid SARIF output.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("returns a typed failure for a SARIF diagnostic without a rule", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({
        version: "2.1.0",
        runs: [{ results: [{ message: { text: "missing rule" } }] }],
      }),
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-analyzer-output",
      stage: "validate-output",
      message: "The Biome analyzer returned invalid SARIF output.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("executes one stable sorted batch containing only supported changed head sources", async () => {
  const executions: AnalyzerExecutionInput[] = [];
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async (input) => {
      executions.push(input);
      return {
        ok: true as const,
        version: "2.5.8",
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      };
    },
  });
  const input: DeterministicReviewInput = {
    repository: "acme/widgets",
    pullRequest: 17,
    reviewer: "deterministic-security",
    diff: {
      files: [
        {
          oldPath: null,
          newPath: "z.ts",
          status: "added",
          lines: [
            {
              location: { side: "new", path: "z.ts", line: 1 },
              content: "safe();",
              changed: true,
            },
          ],
        },
        {
          oldPath: null,
          newPath: "README.md",
          status: "added",
          lines: [
            {
              location: { side: "new", path: "README.md", line: 1 },
              content: "safe",
              changed: true,
            },
          ],
        },
        {
          oldPath: null,
          newPath: "a.js",
          status: "added",
          lines: [
            {
              location: { side: "new", path: "a.js", line: 1 },
              content: "safe();",
              changed: true,
            },
          ],
        },
      ],
    },
    sources: {
      base: [],
      head: [
        { path: "z.ts", content: "safe();" },
        { path: "README.md", content: "safe" },
        { path: "a.js", content: "safe();" },
      ],
    },
  };

  const result = await reviewer.review(input, analyzerContext());

  assert.equal(result.ok, true);
  assert.deepEqual(executions, [
    {
      profile: "deterministic-security",
      rules: ["lint/security/noGlobalEval"],
      sources: [
        { path: "a.js", content: "safe();" },
        { path: "z.ts", content: "safe();" },
      ],
    },
  ]);
  if (result.ok) {
    assert.equal(result.report.coverage.status, "partial");
  }
});

test("converts an analyzer adapter rejection into a typed execution failure", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => {
      throw new Error("untrusted adapter rejection");
    },
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "analyzer-execution-failed",
      stage: "execute",
      message: "The analyzer adapter did not complete successfully.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("rejects a structurally invalid analyzer adapter result", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({ ok: "not-a-boolean" }) as never,
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-analyzer-output",
      stage: "validate-output",
      message: "The analyzer adapter returned an invalid result.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});

test("rejects analyzer provenance that does not match the pinned profile", async () => {
  const reviewer = createDeterministicReviewer({
    clock: () => 1_000,
    executeAnalyzer: async () => ({
      ok: true as const,
      version: "9.9.9",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
    }),
  });

  const result = await reviewer.review(deterministicInput(), analyzerContext());

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-analyzer-output",
      stage: "validate-output",
      message: "The analyzer provenance did not match the deterministic review profile.",
      analyzer: {
        tool: "biome",
        version: "2.5.8",
        profile: "deterministic-security",
        rules: ["lint/security/noGlobalEval"],
      },
    },
  });
});
