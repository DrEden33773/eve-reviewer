import assert from "node:assert/strict";
import test from "node:test";

import {
  type AnalyzeReviewInput,
  type AnalyzerContext,
  type AnalyzerExecutionInput,
  type AnalyzerExecutionResult,
  type ExecuteAnalyzer,
  reviewContractV1,
} from "@eve-reviewer/core";

import { createDeterministicAnalyze } from "../src/deterministic-analyze.ts";

const context: AnalyzerContext = {
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

function oneFileInput(): AnalyzeReviewInput {
  return {
    subject: {
      kind: "pull-request",
      repository: "example/repository",
      number: 7,
    },
    reviewer: "deterministic-security",
    diff: {
      files: [
        {
          oldPath: "src/value.ts",
          newPath: "src/value.ts",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "src/value.ts", line: 1 },
              content: "export const value = 1;",
              changed: true,
            },
            {
              location: { side: "new", path: "src/value.ts", line: 1 },
              content: "export const value = 2;",
              changed: true,
            },
          ],
        },
      ],
    },
    sources: {
      base: [{ path: "src/value.ts", content: "export const value = 1;\n" }],
      head: [{ path: "src/value.ts", content: "export const value = 2;\n" }],
    },
  };
}

test("returns one analyzed outcome with truthful analyzed and skipped file cells", async () => {
  const input: AnalyzeReviewInput = {
    subject: {
      kind: "pull-request",
      repository: "example/repository",
      number: 7,
    },
    reviewer: "deterministic-security",
    diff: {
      files: [
        {
          oldPath: "src/value.ts",
          newPath: "src/value.ts",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "src/value.ts", line: 1 },
              content: "export const value = 1;",
              changed: true,
            },
            {
              location: { side: "new", path: "src/value.ts", line: 1 },
              content: "export const value = 2;",
              changed: true,
            },
          ],
        },
        {
          oldPath: "README.md",
          newPath: "README.md",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "README.md", line: 1 },
              content: "old",
              changed: true,
            },
            {
              location: { side: "new", path: "README.md", line: 1 },
              content: "new",
              changed: true,
            },
          ],
        },
      ],
    },
    sources: {
      base: [],
      head: [
        { path: "src/value.ts", content: "export const value = 2;\n" },
        { path: "README.md", content: "new\n" },
      ],
    },
  };
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async () => ({
      ok: true,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
    }),
  });

  const outcomes = await analyze(input, context);

  assert.deepEqual(outcomes, [
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
        status: "analyzed",
        files: [
          { side: "new", path: "src/value.ts", status: "analyzed" },
          { side: "new", path: "README.md", status: "skipped", reason: "unsupported" },
        ],
        candidates: [],
      },
    },
  ]);
});

test("classifies every skipped file from diff status and head-source availability", async () => {
  const input: AnalyzeReviewInput = {
    subject: {
      kind: "pull-request",
      repository: "example/repository",
      number: 7,
    },
    reviewer: "deterministic-security",
    diff: {
      files: [
        {
          oldPath: "src/value.ts",
          newPath: "src/value.ts",
          status: "modified",
          lines: [
            {
              location: { side: "new", path: "src/value.ts", line: 1 },
              content: "export const value = 2;",
              changed: true,
            },
          ],
        },
        {
          oldPath: "src/obsolete.ts",
          newPath: null,
          status: "deleted",
          lines: [
            {
              location: { side: "old", path: "src/obsolete.ts", line: 1 },
              content: "obsolete();",
              changed: true,
            },
          ],
        },
        {
          oldPath: "assets/logo.png",
          newPath: "assets/logo.png",
          status: "binary",
          lines: [],
        },
        {
          oldPath: "docs/old.md",
          newPath: "docs/new.md",
          status: "renamed",
          lines: [],
        },
        {
          oldPath: "README.md",
          newPath: "README.md",
          status: "modified",
          lines: [
            {
              location: { side: "new", path: "README.md", line: 1 },
              content: "new",
              changed: true,
            },
          ],
        },
        {
          oldPath: "src/missing.ts",
          newPath: "src/missing.ts",
          status: "modified",
          lines: [
            {
              location: { side: "new", path: "src/missing.ts", line: 1 },
              content: "missing();",
              changed: true,
            },
          ],
        },
      ],
    },
    sources: {
      base: [{ path: "src/obsolete.ts", content: "obsolete();\n" }],
      head: [
        { path: "src/value.ts", content: "export const value = 2;\n" },
        { path: "docs/new.md", content: "unchanged\n" },
        { path: "README.md", content: "new\n" },
      ],
    },
  };
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async () => ({
      ok: true,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
    }),
  });

  const outcomes = await analyze(input, context);
  const decoded = reviewContractV1.decodeOutcome(outcomes[0]);

  assert.equal(decoded.ok, true);
  assert.ok("value" in decoded);
  assert.deepEqual(decoded.value.payload.files, [
    { side: "new", path: "src/value.ts", status: "analyzed" },
    { side: "old", path: "src/obsolete.ts", status: "skipped", reason: "deleted" },
    { side: "new", path: "assets/logo.png", status: "skipped", reason: "binary" },
    { side: "new", path: "docs/new.md", status: "skipped", reason: "metadata-only" },
    { side: "new", path: "README.md", status: "skipped", reason: "unsupported" },
    {
      side: "new",
      path: "src/missing.ts",
      status: "skipped",
      reason: "source-unavailable",
    },
  ]);
});

test("returns a skipped outcome without candidates when no file can be analyzed", async () => {
  const input = oneFileInput();
  input.diff.files = [
    {
      oldPath: "docs/old.md",
      newPath: "docs/new.md",
      status: "renamed",
      lines: [],
    },
  ];
  input.sources = {
    base: [{ path: "docs/old.md", content: "unchanged\n" }],
    head: [{ path: "docs/new.md", content: "unchanged\n" }],
  };
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async () => ({
      ok: true,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
    }),
  });

  const outcomes = await analyze(input, context);

  assert.deepEqual(outcomes, [
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
            path: "docs/new.md",
            status: "skipped",
            reason: "metadata-only",
          },
        ],
      },
    },
  ]);
});

test("maps the pinned SARIF rule on a changed new line into a candidate", async () => {
  const input: AnalyzeReviewInput = {
    subject: {
      kind: "pull-request",
      repository: "example/repository",
      number: 7,
    },
    reviewer: "deterministic-security",
    diff: {
      files: [
        {
          oldPath: "src/value.ts",
          newPath: "src/value.ts",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "src/value.ts", line: 1 },
              content: "export const value = input;",
              changed: true,
            },
            {
              location: { side: "new", path: "src/value.ts", line: 1 },
              content: "export const value = eval(input);",
              changed: true,
            },
          ],
        },
      ],
    },
    sources: {
      base: [{ path: "src/value.ts", content: "export const value = input;\n" }],
      head: [{ path: "src/value.ts", content: "export const value = eval(input);\n" }],
    },
  };
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async () => ({
      ok: true,
      version: "2.5.8",
      exitCode: 1,
      stdout: "",
      stderr: "",
      artifacts: [{ uri: "file:///snapshot/src/value.ts", path: "src/value.ts" }],
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
                      artifactLocation: { uri: "file:///snapshot/src/value.ts" },
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

  const outcomes = await analyze(input, context);
  const decoded = reviewContractV1.decodeOutcome(outcomes[0]);

  assert.equal(decoded.ok, true);
  assert.ok("value" in decoded);
  assert.equal(decoded.value.payload.status, "analyzed");
  assert.deepEqual(decoded.value.payload.candidates, [
    {
      ruleId: "security/no-dynamic-eval",
      severity: "critical",
      title: "Dynamic code evaluation",
      explanation: "Code added by the change evaluates text as executable code.",
      location: { side: "new", path: "src/value.ts", line: 1 },
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
});

test("maps an executor failure to a bounded failed outcome", async () => {
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async () => ({
      ok: false,
      failure: "execution",
      version: "2.5.8",
      exitCode: 2,
      message: "raw executor detail",
    }),
  });

  const outcomes = await analyze(oneFileInput(), context);

  assert.deepEqual(outcomes, [
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
        status: "failed",
        files: [{ side: "new", path: "src/value.ts", status: "failed" }],
        diagnostic: {
          code: "analyzer-execution-failed",
          message: "The Biome analyzer did not complete successfully.",
        },
      },
    },
  ]);
  assert.equal(JSON.stringify(outcomes).includes("raw executor detail"), false);
});

test("keeps executor terminal categories distinct in bounded diagnostics", async () => {
  const cases: Array<{
    execution: Exclude<AnalyzerExecutionResult, { ok: true }>;
    diagnostic: Record<string, unknown>;
  }> = [
    {
      execution: {
        ok: false,
        failure: "start",
        version: "2.5.8",
        message: "raw start detail",
        cleanupIncomplete: true,
      },
      diagnostic: {
        code: "analyzer-start-failed",
        message: "Unable to start the Biome analyzer.",
        cleanupIncomplete: true,
      },
    },
    {
      execution: { ok: false, failure: "cleanup", version: "2.5.8" },
      diagnostic: {
        code: "analyzer-cleanup-failed",
        message: "The Biome analyzer could not clean up its temporary resources.",
      },
    },
    {
      execution: {
        ok: false,
        failure: "limit",
        resource: "report",
        version: "2.5.8",
        cleanupIncomplete: true,
      },
      diagnostic: {
        code: "analyzer-limit-exceeded",
        message: "The Biome analyzer exceeded the configured report limit.",
        resource: "report",
        cleanupIncomplete: true,
      },
    },
    {
      execution: {
        ok: false,
        failure: "cancelled",
        version: "2.5.8",
        cleanupIncomplete: true,
      },
      diagnostic: {
        code: "cancelled",
        message: "The Biome analyzer was cancelled during analysis.",
        cleanupIncomplete: true,
      },
    },
    {
      execution: { ok: false, failure: "deadline", version: "2.5.8" },
      diagnostic: {
        code: "deadline-exceeded",
        message: "The Biome analyzer deadline elapsed during analysis.",
      },
    },
  ];

  for (const { execution, diagnostic } of cases) {
    const analyze = createDeterministicAnalyze({
      executeAnalyzer: async () => execution,
    });

    const outcomes = await analyze(oneFileInput(), context);

    assert.deepEqual(
      (outcomes[0] as { payload: { diagnostic: unknown } }).payload.diagnostic,
      diagnostic,
    );
  }
});

test("maps invalid SARIF JSON to a bounded failed outcome", async () => {
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async () => ({
      ok: true,
      version: "2.5.8",
      exitCode: 0,
      stdout: "",
      stderr: "",
      report: "{raw analyzer output",
    }),
  });

  const outcomes = await analyze(oneFileInput(), context);

  assert.deepEqual(outcomes, [
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
        status: "failed",
        files: [{ side: "new", path: "src/value.ts", status: "failed" }],
        diagnostic: {
          code: "invalid-analyzer-output",
          message: "The Biome analyzer returned invalid SARIF output.",
        },
      },
    },
  ]);
});

test("runtime-validates executor results and provenance before reading SARIF", async () => {
  const cases: Array<{
    executeAnalyzer: ExecuteAnalyzer;
    diagnostic: { code: string; message: string };
  }> = [
    {
      executeAnalyzer: async () => {
        throw new Error("raw Adapter failure");
      },
      diagnostic: {
        code: "analyzer-execution-failed",
        message: "The analyzer Adapter did not complete successfully.",
      },
    },
    {
      executeAnalyzer: async () => ({}) as never,
      diagnostic: {
        code: "invalid-analyzer-output",
        message: "The analyzer Adapter returned an invalid result.",
      },
    },
    {
      executeAnalyzer: async () => ({
        ok: true,
        version: "9.9.9",
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [] }),
      }),
      diagnostic: {
        code: "invalid-analyzer-output",
        message: "The analyzer provenance did not match the deterministic review profile.",
      },
    },
    {
      executeAnalyzer: async () =>
        ({
          ok: true,
          version: "2.5.8",
          exitCode: 0,
          stdout: "",
          stderr: "",
          report: JSON.stringify({ version: "2.1.0", runs: [] }),
          cleanupIncomplete: true,
        }) as never,
      diagnostic: {
        code: "analyzer-cleanup-failed",
        message: "The Biome analyzer could not clean up its temporary resources.",
      },
    },
  ];

  for (const { executeAnalyzer, diagnostic } of cases) {
    const analyze = createDeterministicAnalyze({ executeAnalyzer });

    const outcomes = await analyze(oneFileInput(), context);

    assert.deepEqual(
      (outcomes[0] as { payload: { diagnostic: unknown } }).payload.diagnostic,
      diagnostic,
    );
    assert.equal(JSON.stringify(outcomes).includes("raw Adapter failure"), false);
  }
});

test("distinguishes invalid SARIF structure from an out-of-profile diagnostic", async () => {
  const reports = [
    {
      report: { version: "2.0.0", runs: [] },
      diagnostic: {
        code: "invalid-analyzer-output",
        message: "The Biome analyzer returned invalid SARIF output.",
      },
    },
    {
      report: { version: "2.1.0", runs: {} },
      diagnostic: {
        code: "invalid-analyzer-output",
        message: "The Biome analyzer returned invalid SARIF output.",
      },
    },
    {
      report: {
        version: "2.1.0",
        runs: [{ results: [{ locations: [] }] }],
      },
      diagnostic: {
        code: "invalid-analyzer-output",
        message: "The Biome analyzer returned invalid SARIF output.",
      },
    },
    {
      report: {
        version: "2.1.0",
        runs: [{ results: [{ ruleId: "lint/other/rule", locations: [] }] }],
      },
      diagnostic: {
        code: "analyzer-diagnostic",
        message: "Biome reported a diagnostic outside the deterministic review profile.",
      },
    },
  ];

  for (const { report, diagnostic } of reports) {
    const analyze = createDeterministicAnalyze({
      executeAnalyzer: async () => ({
        ok: true,
        version: "2.5.8",
        exitCode: 1,
        stdout: "",
        stderr: "",
        report: JSON.stringify(report),
      }),
    });

    const outcomes = await analyze(oneFileInput(), context);

    assert.deepEqual(
      (outcomes[0] as { payload: { diagnostic: unknown } }).payload.diagnostic,
      diagnostic,
    );
    assert.equal(JSON.stringify(outcomes).includes("lint/other/rule"), false);
  }
});

test("executes one stable sorted batch containing only supported changed head sources", async () => {
  const executions: AnalyzerExecutionInput[] = [];
  const input = oneFileInput();
  input.diff.files = [
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
  ];
  input.sources = {
    base: [],
    head: [
      { path: "z.ts", content: "safe();" },
      { path: "README.md", content: "safe" },
      { path: "a.js", content: "safe();" },
    ],
  };
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async (execution) => {
      executions.push(execution);
      return {
        ok: true,
        version: "2.5.8",
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      };
    },
  });

  await analyze(input, context);

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
});

test("keeps pinned analyzer rules isolated from caller mutation", async () => {
  const executionRules: string[][] = [];
  const analyze = createDeterministicAnalyze({
    executeAnalyzer: async (execution) => {
      executionRules.push([...execution.rules]);
      execution.rules.push("caller/mutation");
      return {
        ok: true,
        version: "2.5.8",
        exitCode: 0,
        stdout: "",
        stderr: "",
        report: JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] }),
      };
    },
  });

  const first = await analyze(oneFileInput(), context);
  const firstDecoded = reviewContractV1.decodeOutcome(first[0]);
  assert.equal(firstDecoded.ok, true);
  assert.ok("value" in firstDecoded);
  firstDecoded.value.payload.analyzer.rules.push("caller/mutation");
  await analyze(oneFileInput(), context);

  assert.deepEqual(executionRules, [
    ["lint/security/noGlobalEval"],
    ["lint/security/noGlobalEval"],
  ]);
});
