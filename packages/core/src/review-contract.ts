import Type from "typebox";
import Schema from "typebox/schema";

const maximumDiffCharacters = 1_000_000;
const maximumSourceCharacters = 1_000_000;
const maximumSourceFilesPerSide = 100;

const sourceFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    content: Type.String({ maxLength: maximumSourceCharacters }),
  },
  { additionalProperties: false },
);

const sourceSnapshotSchema = Type.Object(
  {
    base: Type.Array(sourceFileSchema, { maxItems: maximumSourceFilesPerSide }),
    head: Type.Array(sourceFileSchema, { maxItems: maximumSourceFilesPerSide }),
  },
  { additionalProperties: false },
);

const pullRequestSubjectSchema = Type.Object(
  {
    kind: Type.Literal("pull-request"),
    repository: Type.String({
      minLength: 3,
      maxLength: 512,
      pattern: "^[^/\\s]+/[^/\\s]+$",
    }),
    number: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

const reviewRequestPayloadSchema = Type.Object(
  {
    subject: pullRequestSubjectSchema,
    reviewer: Type.String({ minLength: 1, maxLength: 128 }),
    diff: Type.String({ maxLength: maximumDiffCharacters }),
    sources: sourceSnapshotSchema,
  },
  { additionalProperties: false },
);

const reviewRequestSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-request"),
    schemaVersion: Type.Literal(1),
    payload: reviewRequestPayloadSchema,
  },
  { additionalProperties: false },
);

const reviewRequestValidator = Schema.Compile(reviewRequestSchema);

const analyzerDescriptorSchema = Type.Object(
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

const candidateFindingSchema = Type.Object(
  {
    ruleId: Type.String({ minLength: 1, maxLength: 256 }),
    severity: Type.Union([
      Type.Literal("critical"),
      Type.Literal("high"),
      Type.Literal("medium"),
      Type.Literal("low"),
    ]),
    title: Type.String({ minLength: 1, maxLength: 512 }),
    explanation: Type.String({ minLength: 1, maxLength: 8_192 }),
    location: evidenceLocationSchema,
    fixGuidance: Type.String({ maxLength: 8_192 }),
    suggestedTests: Type.String({ maxLength: 8_192 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
    provenance: Type.Object(
      {
        tool: Type.String({ minLength: 1, maxLength: 128 }),
        version: Type.String({ minLength: 1, maxLength: 128 }),
        ruleId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const analyzedFileOutcomeSchema = Type.Object(
  {
    side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    status: Type.Literal("analyzed"),
  },
  { additionalProperties: false },
);

const skippedFileOutcomeSchema = Type.Object(
  {
    side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    status: Type.Literal("skipped"),
    reason: Type.Union([
      Type.Literal("binary"),
      Type.Literal("deleted"),
      Type.Literal("metadata-only"),
      Type.Literal("source-unavailable"),
      Type.Literal("unsupported"),
    ]),
  },
  { additionalProperties: false },
);

const failedFileOutcomeSchema = Type.Object(
  {
    side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    status: Type.Literal("failed"),
  },
  { additionalProperties: false },
);

const analyzerDiagnosticSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 128 }),
    message: Type.String({ minLength: 1, maxLength: 2_048 }),
    resource: Type.Optional(
      Type.Union([Type.Literal("stdout"), Type.Literal("stderr"), Type.Literal("report")]),
    ),
    cleanupIncomplete: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);

const analyzedOutcomeSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.analyzer-outcome"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        analyzer: analyzerDescriptorSchema,
        status: Type.Literal("analyzed"),
        files: Type.Array(Type.Union([analyzedFileOutcomeSchema, skippedFileOutcomeSchema]), {
          minItems: 1,
          maxItems: 100,
        }),
        candidates: Type.Array(candidateFindingSchema, { maxItems: 1_000 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const skippedOutcomeSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.analyzer-outcome"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        analyzer: analyzerDescriptorSchema,
        status: Type.Literal("skipped"),
        files: Type.Array(skippedFileOutcomeSchema, { minItems: 1, maxItems: 100 }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const failedOutcomeSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.analyzer-outcome"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        analyzer: analyzerDescriptorSchema,
        status: Type.Literal("failed"),
        files: Type.Array(failedFileOutcomeSchema, { minItems: 1, maxItems: 100 }),
        diagnostic: analyzerDiagnosticSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const analyzerOutcomeSchema = Type.Union([
  analyzedOutcomeSchema,
  skippedOutcomeSchema,
  failedOutcomeSchema,
]);

const analyzerOutcomeValidator = Schema.Compile(analyzerOutcomeSchema);

const resultAnalysisSchema = Type.Union([
  Type.Object(
    {
      analyzer: analyzerDescriptorSchema,
      status: Type.Literal("analyzed"),
      side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      analyzer: analyzerDescriptorSchema,
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
      analyzer: analyzerDescriptorSchema,
      status: Type.Literal("failed"),
      side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    },
    { additionalProperties: false },
  ),
]);

const resultCoverageSchema = Type.Object(
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
          analyses: Type.Array(resultAnalysisSchema, { maxItems: 100 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);

const resultFindingSchema = Type.Object(
  {
    ...candidateFindingSchema.properties,
    evidence: Type.String({ maxLength: maximumSourceCharacters }),
  },
  { additionalProperties: false },
);

const resultDiagnosticSchema = Type.Object(
  {
    analyzer: analyzerDescriptorSchema,
    ...analyzerDiagnosticSchema.properties,
  },
  { additionalProperties: false },
);

const successfulResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(true),
        report: Type.Object(
          {
            subject: pullRequestSubjectSchema,
            reviewer: Type.String({ minLength: 1, maxLength: 128 }),
            summary: Type.String({ minLength: 1, maxLength: 8_192 }),
            risk: Type.Union([
              Type.Literal("none"),
              Type.Literal("low"),
              Type.Literal("medium"),
              Type.Literal("high"),
              Type.Literal("critical"),
            ]),
            coverage: resultCoverageSchema,
            analyzers: Type.Array(analyzerDescriptorSchema, { minItems: 1, maxItems: 100 }),
            diagnostics: Type.Array(resultDiagnosticSchema, { maxItems: 100 }),
            findings: Type.Array(resultFindingSchema, { maxItems: 1_000 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const terminalResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Union([Type.Literal("cancelled"), Type.Literal("deadline-exceeded")]),
            stage: Type.Union([Type.Literal("start"), Type.Literal("analyze")]),
            cleanupIncomplete: Type.Optional(Type.Literal(true)),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const partialResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Literal("required-analyzer-failed"),
            stage: Type.Literal("analyze"),
          },
          { additionalProperties: false },
        ),
        partial: Type.Object(
          {
            coverage: resultCoverageSchema,
            analyzers: Type.Array(analyzerDescriptorSchema, { minItems: 1, maxItems: 100 }),
            diagnostics: Type.Array(resultDiagnosticSchema, { minItems: 1, maxItems: 100 }),
            findings: Type.Array(resultFindingSchema, { maxItems: 1_000 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const contractRejectionResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Union([
              Type.Literal("invalid-contract"),
              Type.Literal("unsupported-schema-version"),
            ]),
            stage: Type.Union([
              Type.Literal("decode-request"),
              Type.Literal("decode-outcome"),
              Type.Literal("decode-result"),
              Type.Literal("encode-result"),
            ]),
            issues: Type.Array(
              Type.Object(
                {
                  path: Type.String({ minLength: 1, maxLength: 4_096 }),
                  code: Type.String({ minLength: 1, maxLength: 128 }),
                },
                { additionalProperties: false },
              ),
              { minItems: 1, maxItems: 10 },
            ),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const invalidDiffResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Union([Type.Literal("invalid-diff"), Type.Literal("invalid-source")]),
            message: Type.String({ minLength: 1, maxLength: 8_192 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const analyzerExecutionResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Literal("analyzer-execution-failed"),
            stage: Type.Literal("analyze"),
            message: Type.String({ minLength: 1, maxLength: 2_048 }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const sourceUnavailableResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Union([Type.Literal("source-unavailable"), Type.Literal("source-mismatch")]),
            message: Type.String({ minLength: 1, maxLength: 8_192 }),
            source: Type.Optional(evidenceLocationSchema),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const invalidEvidenceResultSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.review-result"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      {
        ok: Type.Literal(false),
        error: Type.Object(
          {
            code: Type.Literal("invalid-evidence-location"),
            message: Type.String({ minLength: 1, maxLength: 8_192 }),
            finding: Type.Object(
              {
                ruleId: Type.String({ minLength: 1, maxLength: 256 }),
                location: evidenceLocationSchema,
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const reviewResultSchema = Type.Union([
  successfulResultSchema,
  partialResultSchema,
  terminalResultSchema,
  contractRejectionResultSchema,
  invalidDiffResultSchema,
  analyzerExecutionResultSchema,
  sourceUnavailableResultSchema,
  invalidEvidenceResultSchema,
]);
const reviewResultValidator = Schema.Compile(reviewResultSchema);

export type ReviewRequestEnvelope = Type.Static<typeof reviewRequestSchema>;
export type AnalyzerOutcomeEnvelope = Type.Static<typeof analyzerOutcomeSchema>;
export type ReviewResultEnvelope = Type.Static<typeof reviewResultSchema>;

export interface ContractIssue {
  path: string;
  code: string;
}

export interface ContractRejection {
  code: "invalid-contract" | "unsupported-schema-version";
  stage: "decode-request" | "decode-outcome" | "decode-result" | "encode-result";
  issues: ContractIssue[];
}

export type DecodeReviewRequestResult =
  | { ok: true; value: ReviewRequestEnvelope }
  | { ok: false; error: ContractRejection };

export type DecodeAnalyzerOutcomeResult =
  | { ok: true; value: AnalyzerOutcomeEnvelope }
  | { ok: false; error: ContractRejection };

export type EncodeReviewResultResult =
  | { ok: true; value: string }
  | { ok: false; error: ContractRejection };

export type DecodeReviewResultResult =
  | { ok: true; value: ReviewResultEnvelope }
  | { ok: false; error: ContractRejection };

function requestIssues(value: unknown): ContractIssue[] {
  const [, errors] = reviewRequestValidator.Errors(value);
  const error = errors[0];
  if (error?.keyword === "required") {
    const property = error.params.requiredProperties[0];
    return [{ path: `${error.instancePath}/${property}`, code: "required" }];
  }
  if (error?.keyword === "additionalProperties") {
    const property = error.params.additionalProperties[0];
    return [{ path: `${error.instancePath}/${property}`, code: "unknown-field" }];
  }
  return [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }];
}

function invalidOutcome(value: unknown): ContractRejection {
  const [, errors] = analyzerOutcomeValidator.Errors(value);
  const error = errors[0];
  if (error?.keyword === "additionalProperties") {
    const property = error.params.additionalProperties[0];
    return {
      code: "invalid-contract",
      stage: "decode-outcome",
      issues: [{ path: `${error.instancePath}/${property}`, code: "unknown-field" }],
    };
  }
  return {
    code: "invalid-contract",
    stage: "decode-outcome",
    issues: [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }],
  };
}

function invalidResult(
  value: unknown,
  stage: "decode-result" | "encode-result",
): ContractRejection {
  const [, errors] = reviewResultValidator.Errors(value);
  const error =
    errors
      .filter((candidate) => candidate.keyword === "additionalProperties")
      .toSorted((left, right) => right.instancePath.length - left.instancePath.length)[0] ??
    errors[0];
  if (error?.keyword === "additionalProperties") {
    const property = error.params.additionalProperties[0];
    return {
      code: "invalid-contract",
      stage,
      issues: [{ path: `${error.instancePath}/${property}`, code: "unknown-field" }],
    };
  }
  return {
    code: "invalid-contract",
    stage,
    issues: [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }],
  };
}

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

function unsupportedVersion(
  value: unknown,
  stage: ContractRejection["stage"],
): ContractRejection | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    !Number.isSafeInteger(value.schemaVersion) ||
    value.schemaVersion === 1
  ) {
    return undefined;
  }
  return {
    code: "unsupported-schema-version",
    stage,
    issues: [{ path: "/schemaVersion", code: "unsupported" }],
  };
}

export const reviewContractV1 = {
  decodeRequest(value: unknown): DecodeReviewRequestResult {
    const unsupported = unsupportedVersion(value, "decode-request");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (reviewRequestValidator.Check(value)) {
      return { ok: true, value };
    }
    return {
      ok: false,
      error: {
        code: "invalid-contract",
        stage: "decode-request",
        issues: requestIssues(value),
      },
    };
  },
  decodeOutcome(value: unknown): DecodeAnalyzerOutcomeResult {
    const unsupported = unsupportedVersion(value, "decode-outcome");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (analyzerOutcomeValidator.Check(value)) {
      if (value.payload.status === "analyzed") {
        if (!value.payload.files.some((file) => file.status === "analyzed")) {
          return {
            ok: false,
            error: {
              code: "invalid-contract",
              stage: "decode-outcome",
              issues: [{ path: "/payload/status", code: "mismatch" }],
            },
          };
        }
        for (const [index, candidate] of value.payload.candidates.entries()) {
          const analyzer = value.payload.analyzer;
          for (const [field, matches] of [
            ["tool", candidate.provenance.tool === analyzer.tool],
            ["version", candidate.provenance.version === analyzer.version],
            ["ruleId", analyzer.rules.includes(candidate.provenance.ruleId)],
          ] as const) {
            if (!matches) {
              return {
                ok: false,
                error: {
                  code: "invalid-contract",
                  stage: "decode-outcome",
                  issues: [
                    {
                      path: `/payload/candidates/${String(index)}/provenance/${field}`,
                      code: "mismatch",
                    },
                  ],
                },
              };
            }
          }
          if (
            !value.payload.files.some(
              (file) =>
                file.status === "analyzed" &&
                file.side === candidate.location.side &&
                file.path === candidate.location.path,
            )
          ) {
            return {
              ok: false,
              error: {
                code: "invalid-contract",
                stage: "decode-outcome",
                issues: [
                  {
                    path: `/payload/candidates/${String(index)}/location`,
                    code: "mismatch",
                  },
                ],
              },
            };
          }
        }
      }
      return { ok: true, value };
    }
    return { ok: false, error: invalidOutcome(value) };
  },
  decodeResult(value: unknown): DecodeReviewResultResult {
    const unsupported = unsupportedVersion(value, "decode-result");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (reviewResultValidator.Check(value)) {
      return { ok: true, value };
    }
    return { ok: false, error: invalidResult(value, "decode-result") };
  },
  encodeResult(value: unknown): EncodeReviewResultResult {
    const unsupported = unsupportedVersion(value, "encode-result");
    if (unsupported !== undefined) {
      return { ok: false, error: unsupported };
    }
    if (!reviewResultValidator.Check(value)) {
      return { ok: false, error: invalidResult(value, "encode-result") };
    }
    return { ok: true, value: canonicalJson(value) };
  },
};
