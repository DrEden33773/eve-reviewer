import {
  type AnalyzerOutcomeEnvelope,
  type ReviewFinding,
  type ReviewRequestEnvelope,
  type ReviewResultEnvelope,
  reviewContractV1,
} from "@eve-reviewer/core";
import Type from "typebox";
import Schema from "typebox/schema";

const protectedResultSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    {
      ok: Type.Literal(false),
      errorCode: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
]);

const protectedAnalyzerSchema = Type.Object(
  {
    tool: Type.String({ minLength: 1, maxLength: 128 }),
    version: Type.String({ minLength: 1, maxLength: 128 }),
    profile: Type.String({ minLength: 1, maxLength: 128 }),
    rules: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 100,
    }),
  },
  { additionalProperties: false },
);

const evidenceLocationSchema = Type.Object(
  {
    side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    line: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

const protectedFindingSchema = Type.Object(
  {
    ruleId: Type.String({ minLength: 1, maxLength: 256 }),
    severity: Type.Union([
      Type.Literal("critical"),
      Type.Literal("high"),
      Type.Literal("medium"),
      Type.Literal("low"),
    ]),
    location: evidenceLocationSchema,
    evidence: Type.String({ maxLength: 1_000_000 }),
    provenance: Type.Object(
      {
        tool: Type.String({ minLength: 1, maxLength: 128 }),
        version: Type.String({ minLength: 1, maxLength: 128 }),
        ruleId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    explanation: Type.Optional(Type.String({ minLength: 1, maxLength: 8_192 })),
    fixGuidance: Type.Optional(Type.String({ maxLength: 8_192 })),
    suggestedTests: Type.Optional(Type.String({ maxLength: 8_192 })),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  },
  { additionalProperties: false },
);

const protectedAnalysisSchema = Type.Union([
  Type.Object(
    {
      analyzer: protectedAnalyzerSchema,
      status: Type.Literal("analyzed"),
      side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      analyzer: protectedAnalyzerSchema,
      status: Type.Literal("skipped"),
      reason: Type.Union([
        Type.Literal("binary"),
        Type.Literal("deleted"),
        Type.Literal("metadata-only"),
        Type.Literal("source-unavailable"),
        Type.Literal("unsupported"),
      ]),
      side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      analyzer: protectedAnalyzerSchema,
      status: Type.Literal("failed"),
      side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    },
    { additionalProperties: false },
  ),
]);

const protectedCoverageSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("complete"),
      Type.Literal("partial"),
      Type.Literal("no-coverage"),
    ]),
    files: Type.Array(
      Type.Object(
        {
          oldPath: Type.Union([Type.String({ minLength: 1, maxLength: 4_096 }), Type.Null()]),
          newPath: Type.Union([Type.String({ minLength: 1, maxLength: 4_096 }), Type.Null()]),
          status: Type.Union([
            Type.Literal("added"),
            Type.Literal("modified"),
            Type.Literal("deleted"),
            Type.Literal("renamed"),
            Type.Literal("binary"),
            Type.Literal("metadata-only"),
          ]),
          baseSource: Type.Union([
            Type.Literal("available"),
            Type.Literal("unavailable"),
            Type.Literal("not-applicable"),
          ]),
          headSource: Type.Union([
            Type.Literal("available"),
            Type.Literal("unavailable"),
            Type.Literal("not-applicable"),
          ]),
          analyses: Type.Array(protectedAnalysisSchema, { maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);

const protectedFactsSchema = Type.Object(
  {
    result: protectedResultSchema,
    coverage: Type.Optional(protectedCoverageSchema),
    analyzers: Type.Array(protectedAnalyzerSchema, { maxItems: 100 }),
    findings: Type.Array(protectedFindingSchema, { maxItems: 1_000 }),
    summary: Type.Optional(Type.String({ maxLength: 8_192 })),
    risk: Type.Optional(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("critical"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const evaluationCaseSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.evaluation-case"),
    schemaVersion: Type.Literal(1),
    caseId: Type.String({ minLength: 1, maxLength: 128 }),
    source: Type.Literal("synthetic-controlled"),
    request: Type.Unknown(),
    baselineResult: Type.Unknown(),
    candidateOutcomes: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 100 }),
    protected: protectedFactsSchema,
  },
  { additionalProperties: false },
);

const evaluationCaseValidator = Schema.Compile(evaluationCaseSchema);

const targetDescriptorSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 128 }),
    version: Type.String({ minLength: 1, maxLength: 128 }),
    profile: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
const targetDescriptorValidator = Schema.Compile(targetDescriptorSchema);

const comparisonIssueSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    code: Type.String({ minLength: 1, maxLength: 128 }),
    expected: Type.Optional(Type.Unknown()),
    actual: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);

const comparisonOutcomeSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("matched"),
      Type.Literal("mismatched"),
      Type.Literal("failed"),
    ]),
    issues: Type.Array(comparisonIssueSchema, { maxItems: 1_000 }),
  },
  { additionalProperties: false },
);

const countPairSchema = Type.Object(
  {
    passed: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    failed: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

const targetMetricsSchema = Type.Object(
  {
    cases: countPairSchema,
    assertions: countPairSchema,
    findings: Type.Object(
      {
        truePositive: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        falsePositive: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        falseNegative: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      },
      { additionalProperties: false },
    ),
    coverage: Type.Object(
      {
        matched: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
        mismatched: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const completeEvaluationPayloadSchema = Type.Object(
  {
    ok: Type.Literal(true),
    gate: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
    targets: Type.Object(
      { baseline: targetDescriptorSchema, candidate: targetDescriptorSchema },
      { additionalProperties: false },
    ),
    cases: Type.Array(
      Type.Object(
        {
          caseId: Type.String({ minLength: 1, maxLength: 128 }),
          delta: Type.Optional(
            Type.Union([
              Type.Literal("regression"),
              Type.Literal("improvement"),
              Type.Literal("unchanged-pass"),
              Type.Literal("unchanged-fail"),
            ]),
          ),
          baseline: comparisonOutcomeSchema,
          candidate: comparisonOutcomeSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
    metrics: Type.Object(
      {
        baseline: targetMetricsSchema,
        candidate: targetMetricsSchema,
        delta: Type.Object(
          {
            regressions: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
            improvements: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
            unchangedPass: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
            unchangedFail: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          },
          { additionalProperties: false },
        ),
        targetFailures: Type.Object(
          {
            baseline: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
            candidate: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const terminalEvaluationPayloadSchema = Type.Object(
  {
    ok: Type.Literal(false),
    error: Type.Union([
      Type.Object(
        {
          code: Type.Union([Type.Literal("cancelled"), Type.Literal("deadline-exceeded")]),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          code: Type.Union([
            Type.Literal("invalid-dataset"),
            Type.Literal("invalid-configuration"),
            Type.Literal("limit-exceeded"),
          ]),
          issues: Type.Array(comparisonIssueSchema, { minItems: 1, maxItems: 1_000 }),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);

const evaluationResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.evaluation-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Union([completeEvaluationPayloadSchema, terminalEvaluationPayloadSchema]),
  },
  { additionalProperties: false },
);
const evaluationResultValidator = Schema.Compile(evaluationResultSchema);

export interface EvaluationContractIssue {
  path: string;
  code: string;
}

export interface EvaluationContractRejection {
  code: "invalid-contract" | "unsupported-schema-version";
  stage: "decode-case" | "encode-case" | "decode-result" | "encode-result";
  issues: EvaluationContractIssue[];
}

export type ProtectedEvaluationFacts = Type.Static<typeof protectedFactsSchema>;

export interface EvaluationCaseV1 {
  kind: "eve-reviewer.evaluation-case";
  schemaVersion: 1;
  caseId: string;
  source: "synthetic-controlled";
  request: ReviewRequestEnvelope;
  baselineResult: ReviewResultEnvelope;
  candidateOutcomes: AnalyzerOutcomeEnvelope[];
  protected: ProtectedEvaluationFacts;
}

export type DecodeEvaluationCaseResult =
  | { ok: true; value: EvaluationCaseV1 }
  | { ok: false; error: EvaluationContractRejection };

export type EncodeEvaluationCaseResult =
  | { ok: true; value: string }
  | { ok: false; error: EvaluationContractRejection };

export type EvaluationResultEnvelope = Type.Static<typeof evaluationResultSchema>;
export type DecodeEvaluationResult =
  | { ok: true; value: EvaluationResultEnvelope }
  | { ok: false; error: EvaluationContractRejection };
export type EncodeEvaluationResult =
  | { ok: true; value: string }
  | { ok: false; error: EvaluationContractRejection };

function caseIssues(value: unknown): EvaluationContractIssue[] {
  const [, errors] = evaluationCaseValidator.Errors(value);
  const error = errors[0];
  if (error?.keyword === "required") {
    return [
      {
        path: `${error.instancePath}/${error.params.requiredProperties[0]}`,
        code: "required",
      },
    ];
  }
  if (error?.keyword === "additionalProperties") {
    return [
      {
        path: `${error.instancePath}/${error.params.additionalProperties[0]}`,
        code: "unknown-field",
      },
    ];
  }
  return [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }];
}

function resultIssues(value: unknown): EvaluationContractIssue[] {
  const [, errors] = evaluationResultValidator.Errors(value);
  const error =
    errors
      .filter((candidate) => candidate.keyword === "additionalProperties")
      .toSorted((left, right) => right.instancePath.length - left.instancePath.length)[0] ??
    errors[0];
  if (error?.keyword === "required") {
    return [
      {
        path: `${error.instancePath}/${error.params.requiredProperties[0]}`,
        code: "required",
      },
    ];
  }
  if (error?.keyword === "additionalProperties") {
    return [
      {
        path: `${error.instancePath}/${error.params.additionalProperties[0]}`,
        code: "unknown-field",
      },
    ];
  }
  return [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }];
}

function unsupportedEvaluationVersion(
  value: unknown,
  stage: "decode-case" | "encode-case" | "decode-result" | "encode-result",
): EvaluationContractRejection | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as { kind?: unknown; schemaVersion?: unknown };
  if (
    (record.kind === "eve-reviewer.evaluation-case" ||
      record.kind === "eve-reviewer.evaluation-result") &&
    record.schemaVersion !== undefined &&
    record.schemaVersion !== 1
  ) {
    return {
      code: "unsupported-schema-version",
      stage,
      issues: [{ path: "/schemaVersion", code: "unsupported" }],
    };
  }
  return undefined;
}

function nestedIssues(
  prefix: string,
  issues: EvaluationContractIssue[],
): EvaluationContractIssue[] {
  return issues.map((issue) => ({
    path: `${prefix}${issue.path === "/" ? "" : issue.path}`,
    code: issue.code,
  }));
}

export interface EvaluationTargetDescriptor {
  name: string;
  version: string;
  profile: string;
}

export interface ReplayTargetContext {
  caseId: string;
  signal: AbortSignal;
  deadline: number;
}

export interface ReplayTarget {
  descriptor: EvaluationTargetDescriptor;
  run(request: ReviewRequestEnvelope, context: ReplayTargetContext): Promise<unknown>;
}

export interface EvaluationLimits {
  maximumDatasetBytes: number;
  maximumCases: number;
  maximumProtectedFacts: number;
  maximumFindings: number;
  maximumResultBytes: number;
  maximumIssues: number;
  maximumIssueValueCharacters: number;
}

export interface EvaluationContext {
  signal: AbortSignal;
  deadline: number;
  limits: EvaluationLimits;
}

const evaluationHardLimits: EvaluationLimits = {
  maximumDatasetBytes: 12_000_000,
  maximumCases: 100,
  maximumProtectedFacts: 10_000,
  maximumFindings: 10_000,
  maximumResultBytes: 5_000_000,
  maximumIssues: 1_000,
  maximumIssueValueCharacters: 2_048,
};
const evaluationLimitNames = [
  "maximumDatasetBytes",
  "maximumCases",
  "maximumProtectedFacts",
  "maximumFindings",
  "maximumResultBytes",
  "maximumIssues",
  "maximumIssueValueCharacters",
] as const;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonByteLength(value: unknown): number | undefined {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : new TextEncoder().encode(json).byteLength;
  } catch {
    return undefined;
  }
}

function jsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function nonJsonPath(
  value: unknown,
  path = "/",
  seen: Set<object> = new Set(),
): string | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : path;
  }
  if (typeof value !== "object") {
    return path;
  }
  if (seen.has(value)) {
    return path;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const itemPath = nonJsonPath(
        item,
        path === "/" ? `/${String(index)}` : `${path}/${String(index)}`,
        seen,
      );
      if (itemPath !== undefined) {
        return itemPath;
      }
    }
    seen.delete(value);
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return path;
  }
  for (const [key, item] of Object.entries(value)) {
    const itemPath = nonJsonPath(
      item,
      path === "/" ? `/${jsonPointerSegment(key)}` : `${path}/${jsonPointerSegment(key)}`,
      seen,
    );
    if (itemPath !== undefined) {
      return itemPath;
    }
  }
  seen.delete(value);
  return undefined;
}

function reviewFacts(result: ReviewResultEnvelope) {
  if (result.payload.ok) {
    return {
      result: { ok: true as const },
      coverage: result.payload.report.coverage,
      analyzers: result.payload.report.analyzers,
      findings: result.payload.report.findings,
      summary: result.payload.report.summary,
      risk: result.payload.report.risk,
    };
  }
  if ("partial" in result.payload) {
    return {
      result: { ok: false as const, errorCode: result.payload.error.code },
      coverage: result.payload.partial.coverage,
      analyzers: result.payload.partial.analyzers,
      findings: result.payload.partial.findings,
    };
  }
  return {
    result: { ok: false as const, errorCode: result.payload.error.code },
    analyzers: [],
    findings: [],
  };
}

function matches(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function protectedFindingValue(finding: ReviewFinding) {
  return {
    ruleId: finding.ruleId,
    severity: finding.severity,
    location: finding.location,
    evidence: finding.evidence,
    provenance: finding.provenance,
  };
}

function findingMatchesProtected(
  finding: ReviewFinding,
  expected: ProtectedEvaluationFacts["findings"][number],
): boolean {
  const actual = finding as unknown as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => matches(actual[key], value));
}

function compareFindings(
  findings: ReviewFinding[],
  expected: ProtectedEvaluationFacts["findings"],
) {
  const unusedActual = new Set(findings.map((_, index) => index));
  let truePositive = 0;
  for (const protectedFinding of expected) {
    const matchedIndex = findings.findIndex(
      (finding, index) =>
        unusedActual.has(index) && findingMatchesProtected(finding, protectedFinding),
    );
    if (matchedIndex !== -1) {
      unusedActual.delete(matchedIndex);
      truePositive += 1;
    }
  }
  return {
    truePositive,
    falsePositive: unusedActual.size,
    falseNegative: expected.length - truePositive,
  };
}

function protectedFactCount(protectedFacts: ProtectedEvaluationFacts): number {
  return (
    1 +
    protectedFacts.analyzers.length +
    (protectedFacts.coverage === undefined
      ? 0
      : 1 +
        protectedFacts.coverage.files.length +
        protectedFacts.coverage.files.reduce((total, file) => total + file.analyses.length, 0)) +
    (protectedFacts.summary === undefined ? 0 : 1) +
    (protectedFacts.risk === undefined ? 0 : 1)
  );
}

function embeddedFindingCount(evaluationCase: EvaluationCaseV1): number {
  const baselineFindings = reviewFacts(evaluationCase.baselineResult).findings.length;
  const candidateFindings = evaluationCase.candidateOutcomes.reduce(
    (total, outcome) =>
      total + (outcome.payload.status === "analyzed" ? outcome.payload.candidates.length : 0),
    0,
  );
  return evaluationCase.protected.findings.length + baselineFindings + candidateFindings;
}

interface EvaluationIssue {
  path: string;
  code: string;
  expected?: unknown;
  actual?: unknown;
}

interface TargetEvaluation {
  outcome: {
    status: "matched" | "mismatched";
    issues: EvaluationIssue[];
  };
  assertions: { passed: number; failed: number };
  findings: { truePositive: number; falsePositive: number; falseNegative: number };
  coverage: { matched: number; mismatched: number };
}

function mismatchIssue(path: string, expected: unknown, actual: unknown): EvaluationIssue {
  return actual === undefined
    ? { path, code: "mismatch", expected }
    : { path, code: "mismatch", expected, actual };
}

function evaluateTarget(
  result: ReviewResultEnvelope,
  expected: ProtectedEvaluationFacts,
): TargetEvaluation {
  const actual = reviewFacts(result);
  const actualFindings = actual.findings.map(protectedFindingValue);
  const findingCounts = compareFindings(actual.findings, expected.findings);
  const findingsMatch = findingCounts.falsePositive === 0 && findingCounts.falseNegative === 0;
  const coverageMatch =
    expected.coverage === undefined || matches(actual.coverage, expected.coverage);
  const resultMatch = matches(actual.result, expected.result);
  const analyzersMatch = matches(actual.analyzers, expected.analyzers);
  const summaryMatch = expected.summary === undefined || actual.summary === expected.summary;
  const riskMatch = expected.risk === undefined || actual.risk === expected.risk;
  const assertions = [resultMatch, analyzersMatch, findingsMatch];
  if (expected.coverage !== undefined) {
    assertions.push(coverageMatch);
  }
  if (expected.summary !== undefined) {
    assertions.push(summaryMatch);
  }
  if (expected.risk !== undefined) {
    assertions.push(riskMatch);
  }
  const passed = assertions.filter(Boolean).length;
  const findingIssues = findingsMatch
    ? []
    : [
        {
          path: "/protected/findings",
          code:
            findingCounts.falseNegative === 0
              ? "unexpected"
              : findingCounts.falsePositive === 0
                ? "missing"
                : "mismatch",
          expected: expected.findings,
          actual: actualFindings,
        },
      ];
  const resultIssues = resultMatch
    ? []
    : [mismatchIssue("/protected/result", expected.result, actual.result)];
  const coverageIssues = coverageMatch
    ? []
    : [mismatchIssue("/protected/coverage", expected.coverage, actual.coverage)];
  const analyzerIssues = analyzersMatch
    ? []
    : [mismatchIssue("/protected/analyzers", expected.analyzers, actual.analyzers)];
  const summaryIssues = summaryMatch
    ? []
    : [mismatchIssue("/protected/summary", expected.summary, actual.summary)];
  const riskIssues = riskMatch
    ? []
    : [mismatchIssue("/protected/risk", expected.risk, actual.risk)];
  return {
    outcome: {
      status: passed === assertions.length ? ("matched" as const) : ("mismatched" as const),
      issues: [
        ...resultIssues,
        ...coverageIssues,
        ...analyzerIssues,
        ...findingIssues,
        ...summaryIssues,
        ...riskIssues,
      ],
    },
    assertions: { passed, failed: assertions.length - passed },
    findings: findingCounts,
    coverage:
      expected.coverage === undefined
        ? { matched: 0, mismatched: 0 }
        : coverageMatch
          ? { matched: 1, mismatched: 0 }
          : { matched: 0, mismatched: 1 },
  };
}

function targetMetrics(targets: TargetEvaluation[]) {
  return {
    cases: {
      passed: targets.filter((target) => target.outcome.status === "matched").length,
      failed: targets.filter((target) => target.outcome.status !== "matched").length,
    },
    assertions: {
      passed: targets.reduce((total, target) => total + target.assertions.passed, 0),
      failed: targets.reduce((total, target) => total + target.assertions.failed, 0),
    },
    findings: {
      truePositive: targets.reduce((total, target) => total + target.findings.truePositive, 0),
      falsePositive: targets.reduce((total, target) => total + target.findings.falsePositive, 0),
      falseNegative: targets.reduce((total, target) => total + target.findings.falseNegative, 0),
    },
    coverage: {
      matched: targets.reduce((total, target) => total + target.coverage.matched, 0),
      mismatched: targets.reduce((total, target) => total + target.coverage.mismatched, 0),
    },
  };
}

type ComparisonOutcome =
  | TargetEvaluation["outcome"]
  | {
      status: "failed";
      issues: { path: string; code: string }[];
    };
type CaseDelta = "regression" | "improvement" | "unchanged-pass" | "unchanged-fail";

function boundIssueValues(issue: EvaluationIssue, maximumCharacters: number): EvaluationIssue {
  const bounded: EvaluationIssue = { path: issue.path, code: issue.code };
  for (const field of ["expected", "actual"] as const) {
    const value = issue[field];
    if (value === undefined) {
      continue;
    }
    const characters = canonicalJson(value).length;
    if (characters <= maximumCharacters) {
      bounded[field] = value;
    }
  }
  return bounded;
}

function boundEvaluationIssueValues(
  evaluation: TargetEvaluation,
  maximumCharacters: number,
): TargetEvaluation {
  return {
    ...evaluation,
    outcome: {
      ...evaluation.outcome,
      issues: evaluation.outcome.issues.map((issue) => boundIssueValues(issue, maximumCharacters)),
    },
  };
}

async function runReplayTarget(
  target: ReplayTarget,
  request: ReviewRequestEnvelope,
  context: ReplayTargetContext,
  expected: ProtectedEvaluationFacts,
  maximumResultBytes: number,
  maximumIssueValueCharacters: number,
  clock: () => number,
): Promise<
  | {
      ok: true;
      evaluation: TargetEvaluation;
      outcome: TargetEvaluation["outcome"];
      findingCount: number;
    }
  | { ok: false; outcome: ComparisonOutcome }
  | { ok: false; terminal: EvaluationResultEnvelope }
> {
  let rawResult: unknown;
  try {
    rawResult = await target.run(structuredClone(request), { ...context });
  } catch {
    return {
      ok: false,
      outcome: {
        status: "failed",
        issues: [{ path: "/", code: "target-failed" }],
      },
    };
  }
  if (context.signal.aborted) {
    return { ok: false, terminal: terminalResult("cancelled") };
  }
  if (clock() >= context.deadline) {
    return { ok: false, terminal: terminalResult("deadline-exceeded") };
  }
  let clonedResult: unknown;
  let resultBytes: number;
  try {
    clonedResult = structuredClone(rawResult);
    resultBytes = new TextEncoder().encode(canonicalJson(clonedResult)).byteLength;
  } catch {
    return {
      ok: false,
      outcome: {
        status: "failed",
        issues: [{ path: "/", code: "invalid-result" }],
      },
    };
  }
  if (resultBytes > maximumResultBytes) {
    return {
      ok: false,
      terminal: limitExceededResult("/limits/maximumResultBytes", maximumResultBytes, resultBytes),
    };
  }
  const decoded = reviewContractV1.decodeResult(clonedResult);
  if (!decoded.ok) {
    return {
      ok: false,
      outcome: {
        status: "failed",
        issues: [{ path: "/", code: "invalid-result" }],
      },
    };
  }
  const evaluation = boundEvaluationIssueValues(
    evaluateTarget(decoded.value, expected),
    maximumIssueValueCharacters,
  );
  return {
    ok: true,
    evaluation,
    outcome: evaluation.outcome,
    findingCount: reviewFacts(decoded.value).findings.length,
  };
}

function terminalResult(code: "cancelled" | "deadline-exceeded"): EvaluationResultEnvelope {
  return {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: { ok: false, error: { code } },
  };
}

function limitExceededResult(
  path: string,
  expected: number,
  actual: number,
): EvaluationResultEnvelope {
  return {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: {
        code: "limit-exceeded",
        issues: [{ path, code: "exceeded", expected, actual }],
      },
    },
  };
}

function configurationResult(path: string, code: string): EvaluationResultEnvelope {
  return {
    kind: "eve-reviewer.evaluation-result",
    schemaVersion: 1,
    payload: {
      ok: false,
      error: { code: "invalid-configuration", issues: [{ path, code }] },
    },
  };
}

function descriptorIssue(
  prefix: "/targets/baseline" | "/targets/candidate",
  value: unknown,
): { path: string; code: string } | undefined {
  if (targetDescriptorValidator.Check(value)) {
    return undefined;
  }
  const [, errors] = targetDescriptorValidator.Errors(value);
  const error = errors[0];
  if (error?.keyword === "additionalProperties") {
    return {
      path: `${prefix}${error.instancePath}/${error.params.additionalProperties[0]}`,
      code: "unknown-field",
    };
  }
  if (error?.keyword === "required") {
    return {
      path: `${prefix}${error.instancePath}/${error.params.requiredProperties[0]}`,
      code: "required",
    };
  }
  return { path: `${prefix}${error?.instancePath || ""}`, code: error?.keyword ?? "invalid" };
}

function evaluationTermination(
  context: EvaluationContext,
  clock: () => number,
): "cancelled" | "deadline-exceeded" | undefined {
  if (context.signal.aborted) {
    return "cancelled";
  }
  if (clock() >= context.deadline) {
    return "deadline-exceeded";
  }
  return undefined;
}

export const evaluationV1 = {
  decodeCase(value: unknown): DecodeEvaluationCaseResult {
    const unsupported = unsupportedEvaluationVersion(value, "decode-case");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (!evaluationCaseValidator.Check(value)) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "decode-case",
          issues: caseIssues(value),
        },
      };
    }
    const request = reviewContractV1.decodeRequest(value.request);
    if (!request.ok) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "decode-case",
          issues: nestedIssues("/request", request.error.issues),
        },
      };
    }
    const baseline = reviewContractV1.decodeResult(value.baselineResult);
    if (!baseline.ok) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "decode-case",
          issues: nestedIssues("/baselineResult", baseline.error.issues),
        },
      };
    }
    const candidateOutcomes: AnalyzerOutcomeEnvelope[] = [];
    for (const [index, candidateOutcome] of value.candidateOutcomes.entries()) {
      const outcome = reviewContractV1.decodeOutcome(candidateOutcome);
      if (!outcome.ok) {
        return {
          ok: false,
          error: {
            code: "invalid-contract",
            stage: "decode-case",
            issues: nestedIssues(`/candidateOutcomes/${String(index)}`, outcome.error.issues),
          },
        };
      }
      candidateOutcomes.push(outcome.value);
    }
    return {
      ok: true,
      value: structuredClone({
        ...value,
        request: request.value,
        baselineResult: baseline.value,
        candidateOutcomes,
      }),
    };
  },
  encodeCase(value: unknown): EncodeEvaluationCaseResult {
    const decoded = evaluationV1.decodeCase(value);
    if (!decoded.ok) {
      return {
        ok: false,
        error: { ...decoded.error, stage: "encode-case" },
      };
    }
    return { ok: true, value: canonicalJson(decoded.value) };
  },
  decodeResult(value: unknown): DecodeEvaluationResult {
    const unsupported = unsupportedEvaluationVersion(value, "decode-result");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (!evaluationResultValidator.Check(value)) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "decode-result",
          issues: resultIssues(value),
        },
      };
    }
    const invalidJsonPath = nonJsonPath(value);
    if (invalidJsonPath !== undefined) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "decode-result",
          issues: [{ path: invalidJsonPath, code: "non-json" }],
        },
      };
    }
    return { ok: true, value: structuredClone(value) };
  },
  encodeResult(value: unknown): EncodeEvaluationResult {
    const unsupported = unsupportedEvaluationVersion(value, "encode-result");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (!evaluationResultValidator.Check(value)) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "encode-result",
          issues: resultIssues(value),
        },
      };
    }
    const invalidJsonPath = nonJsonPath(value);
    if (invalidJsonPath !== undefined) {
      return {
        ok: false,
        error: {
          code: "invalid-contract",
          stage: "encode-result",
          issues: [{ path: invalidJsonPath, code: "non-json" }],
        },
      };
    }
    return { ok: true, value: canonicalJson(value) };
  },
  createComparer(dependencies: {
    baseline: ReplayTarget;
    candidate: ReplayTarget;
    clock: () => number;
  }) {
    return {
      async compare(
        cases: unknown[],
        context: EvaluationContext,
      ): Promise<EvaluationResultEnvelope> {
        const initialTermination = evaluationTermination(context, dependencies.clock);
        if (initialTermination !== undefined) {
          return terminalResult(initialTermination);
        }
        if (!Number.isFinite(context.deadline)) {
          return configurationResult("/deadline", "finite-number");
        }
        for (const limitName of evaluationLimitNames) {
          const limit = context.limits[limitName];
          if (!Number.isSafeInteger(limit) || limit <= 0) {
            return configurationResult(`/limits/${limitName}`, "positive-integer");
          }
        }
        const baselineDescriptorIssue = descriptorIssue(
          "/targets/baseline",
          dependencies.baseline.descriptor,
        );
        if (baselineDescriptorIssue !== undefined) {
          return configurationResult(baselineDescriptorIssue.path, baselineDescriptorIssue.code);
        }
        const candidateDescriptorIssue = descriptorIssue(
          "/targets/candidate",
          dependencies.candidate.descriptor,
        );
        if (candidateDescriptorIssue !== undefined) {
          return configurationResult(candidateDescriptorIssue.path, candidateDescriptorIssue.code);
        }
        if (matches(dependencies.baseline.descriptor, dependencies.candidate.descriptor)) {
          return configurationResult("/targets/candidate", "duplicate-target");
        }
        if (cases.length === 0) {
          return {
            kind: "eve-reviewer.evaluation-result",
            schemaVersion: 1,
            payload: {
              ok: false,
              error: {
                code: "invalid-dataset",
                issues: [{ path: "/cases", code: "min-items" }],
              },
            },
          };
        }
        const maximumDatasetBytes = Math.min(
          evaluationHardLimits.maximumDatasetBytes,
          context.limits.maximumDatasetBytes,
        );
        const datasetBytes = jsonByteLength(cases);
        if (datasetBytes === undefined) {
          return {
            kind: "eve-reviewer.evaluation-result",
            schemaVersion: 1,
            payload: {
              ok: false,
              error: {
                code: "invalid-dataset",
                issues: [{ path: "/cases", code: "non-json" }],
              },
            },
          };
        }
        if (datasetBytes > maximumDatasetBytes) {
          return limitExceededResult(
            "/limits/maximumDatasetBytes",
            maximumDatasetBytes,
            datasetBytes,
          );
        }
        const maximumCases = Math.min(
          evaluationHardLimits.maximumCases,
          context.limits.maximumCases,
        );
        if (cases.length > maximumCases) {
          return limitExceededResult("/limits/maximumCases", maximumCases, cases.length);
        }
        const decodedCases: EvaluationCaseV1[] = [];
        const caseIds = new Set<string>();
        for (const [index, evaluationCase] of cases.entries()) {
          const decoded = evaluationV1.decodeCase(evaluationCase);
          if (!decoded.ok) {
            return {
              kind: "eve-reviewer.evaluation-result",
              schemaVersion: 1,
              payload: {
                ok: false,
                error: {
                  code: "invalid-dataset",
                  issues: nestedIssues(`/cases/${String(index)}`, decoded.error.issues),
                },
              },
            };
          }
          if (caseIds.has(decoded.value.caseId)) {
            return {
              kind: "eve-reviewer.evaluation-result",
              schemaVersion: 1,
              payload: {
                ok: false,
                error: {
                  code: "invalid-dataset",
                  issues: [
                    {
                      path: `/cases/${String(index)}/caseId`,
                      code: "duplicate-case-id",
                    },
                  ],
                },
              },
            };
          }
          caseIds.add(decoded.value.caseId);
          decodedCases.push(decoded.value);
        }
        const protectedFacts = decodedCases.reduce(
          (total, evaluationCase) => total + protectedFactCount(evaluationCase.protected),
          0,
        );
        const maximumProtectedFacts = Math.min(
          evaluationHardLimits.maximumProtectedFacts,
          context.limits.maximumProtectedFacts,
        );
        if (protectedFacts > maximumProtectedFacts) {
          return limitExceededResult(
            "/limits/maximumProtectedFacts",
            maximumProtectedFacts,
            protectedFacts,
          );
        }
        const embeddedFindings = decodedCases.reduce(
          (total, evaluationCase) => total + embeddedFindingCount(evaluationCase),
          0,
        );
        const maximumFindings = Math.min(
          evaluationHardLimits.maximumFindings,
          context.limits.maximumFindings,
        );
        if (embeddedFindings > maximumFindings) {
          return limitExceededResult("/limits/maximumFindings", maximumFindings, embeddedFindings);
        }
        const maximumResultBytes = Math.min(
          evaluationHardLimits.maximumResultBytes,
          context.limits.maximumResultBytes,
        );
        const maximumIssueValueCharacters = Math.min(
          evaluationHardLimits.maximumIssueValueCharacters,
          context.limits.maximumIssueValueCharacters,
        );
        const maximumIssues = Math.min(
          evaluationHardLimits.maximumIssues,
          context.limits.maximumIssues,
        );
        decodedCases.sort((left, right) => left.caseId.localeCompare(right.caseId));
        const caseResults: {
          caseId: string;
          delta?: CaseDelta;
          baseline: ComparisonOutcome;
          candidate: ComparisonOutcome;
        }[] = [];
        const baselineEvaluations: ReturnType<typeof evaluateTarget>[] = [];
        const candidateEvaluations: ReturnType<typeof evaluateTarget>[] = [];
        let baselineFailures = 0;
        let candidateFailures = 0;
        let collectedIssues = 0;
        let collectedFindings = embeddedFindings;
        for (const evaluationCase of decodedCases) {
          const targetContext = {
            caseId: evaluationCase.caseId,
            signal: context.signal,
            deadline: context.deadline,
          };
          const baseline = await runReplayTarget(
            dependencies.baseline,
            evaluationCase.request,
            targetContext,
            evaluationCase.protected,
            maximumResultBytes,
            maximumIssueValueCharacters,
            dependencies.clock,
          );
          if ("terminal" in baseline) {
            return baseline.terminal;
          }
          const afterBaselineTermination = evaluationTermination(context, dependencies.clock);
          if (afterBaselineTermination !== undefined) {
            return terminalResult(afterBaselineTermination);
          }
          if (baseline.ok) {
            collectedFindings += baseline.findingCount;
            if (collectedFindings > maximumFindings) {
              return limitExceededResult(
                "/limits/maximumFindings",
                maximumFindings,
                collectedFindings,
              );
            }
          }
          const candidate = await runReplayTarget(
            dependencies.candidate,
            evaluationCase.request,
            targetContext,
            evaluationCase.protected,
            maximumResultBytes,
            maximumIssueValueCharacters,
            dependencies.clock,
          );
          if ("terminal" in candidate) {
            return candidate.terminal;
          }
          const afterCandidateTermination = evaluationTermination(context, dependencies.clock);
          if (afterCandidateTermination !== undefined) {
            return terminalResult(afterCandidateTermination);
          }
          if (candidate.ok) {
            collectedFindings += candidate.findingCount;
            if (collectedFindings > maximumFindings) {
              return limitExceededResult(
                "/limits/maximumFindings",
                maximumFindings,
                collectedFindings,
              );
            }
          }
          collectedIssues += baseline.outcome.issues.length + candidate.outcome.issues.length;
          if (collectedIssues > maximumIssues) {
            return limitExceededResult("/limits/maximumIssues", maximumIssues, collectedIssues);
          }
          if (baseline.ok) {
            baselineEvaluations.push(baseline.evaluation);
          } else {
            baselineFailures += 1;
          }
          if (candidate.ok) {
            candidateEvaluations.push(candidate.evaluation);
          } else {
            candidateFailures += 1;
          }
          const caseResult: (typeof caseResults)[number] = {
            caseId: evaluationCase.caseId,
            baseline: baseline.outcome,
            candidate: candidate.outcome,
          };
          if (baseline.ok && candidate.ok) {
            const baselinePassed = baseline.evaluation.outcome.status === "matched";
            const candidatePassed = candidate.evaluation.outcome.status === "matched";
            caseResult.delta = baselinePassed
              ? candidatePassed
                ? "unchanged-pass"
                : "regression"
              : candidatePassed
                ? "improvement"
                : "unchanged-fail";
          }
          caseResults.push(caseResult);
        }
        const deltaMetrics = {
          regressions: caseResults.filter((result) => result.delta === "regression").length,
          improvements: caseResults.filter((result) => result.delta === "improvement").length,
          unchangedPass: caseResults.filter((result) => result.delta === "unchanged-pass").length,
          unchangedFail: caseResults.filter((result) => result.delta === "unchanged-fail").length,
        };
        const completedResult: EvaluationResultEnvelope = {
          kind: "eve-reviewer.evaluation-result",
          schemaVersion: 1,
          payload: {
            ok: true,
            gate:
              candidateFailures === 0 &&
              candidateEvaluations.every((evaluation) => evaluation.outcome.status === "matched")
                ? "pass"
                : "fail",
            targets: {
              baseline: structuredClone(dependencies.baseline.descriptor),
              candidate: structuredClone(dependencies.candidate.descriptor),
            },
            cases: caseResults,
            metrics: {
              baseline: targetMetrics(baselineEvaluations),
              candidate: targetMetrics(candidateEvaluations),
              delta: deltaMetrics,
              targetFailures: {
                baseline: baselineFailures,
                candidate: candidateFailures,
              },
            },
          },
        };
        const completedResultBytes = new TextEncoder().encode(
          canonicalJson(completedResult),
        ).byteLength;
        if (completedResultBytes > maximumResultBytes) {
          return limitExceededResult(
            "/limits/maximumResultBytes",
            maximumResultBytes,
            completedResultBytes,
          );
        }
        return completedResult;
      },
    };
  },
};
