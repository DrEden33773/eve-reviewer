// biome-ignore-all lint/complexity/useLiteralKeys: Runtime validation intentionally narrows unknown records by exact dynamic keys.
import { createHash } from "node:crypto";
import Type from "typebox";
import Schema from "typebox/schema";
import type { LocalReviewRequestEnvelope } from "./local-review-contract.ts";
import {
  type AnalyzerOutcomeEnvelope,
  type ReviewRequestEnvelope,
  reviewContractV1,
} from "./review-contract.ts";
import { parseUnifiedDiff } from "./unified-diff.ts";

const maximumEnvelopeBytes = 1_048_576;

const locationSchema = Type.Object(
  {
    side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
    path: Type.String({ minLength: 1, maxLength: 4_096 }),
    line: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
  },
  { additionalProperties: false },
);

const candidateSchema = Type.Object(
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
    location: locationSchema,
    fixGuidance: Type.String({ maxLength: 8_192 }),
    suggestedTests: Type.String({ maxLength: 8_192 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

const envelopeSchema = Type.Object(
  {
    kind: Type.Literal("eve-reviewer.model-review-candidates"),
    schemaVersion: Type.Literal(1),
    payload: Type.Object(
      { candidates: Type.Array(candidateSchema, { maxItems: 100 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const envelopeValidator = Schema.Compile(envelopeSchema);

export interface ModelReviewCandidate {
  readonly ruleId: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly title: string;
  readonly explanation: string;
  readonly location: {
    readonly side: "old" | "new";
    readonly path: string;
    readonly line: number;
  };
  readonly fixGuidance: string;
  readonly suggestedTests: string;
  readonly confidence: number;
}

export interface ModelReviewCandidatesEnvelope {
  readonly kind: "eve-reviewer.model-review-candidates";
  readonly schemaVersion: 1;
  readonly payload: { readonly candidates: readonly ModelReviewCandidate[] };
}

export interface ModelReviewContractIssue {
  readonly path: string;
  readonly code: string;
}

export type ModelReviewContractResult =
  | { readonly ok: true; readonly value: ModelReviewCandidatesEnvelope }
  | { readonly ok: false; readonly issues: readonly ModelReviewContractIssue[] };

function invalid(value: unknown): ModelReviewContractResult {
  const [, errors] = envelopeValidator.Errors(value);
  const error =
    errors
      .filter((candidate) => candidate.keyword === "additionalProperties")
      .toSorted((left, right) => right.instancePath.length - left.instancePath.length)[0] ??
    errors[0];
  if (error?.keyword === "additionalProperties") {
    return {
      ok: false,
      issues: [
        {
          path: `${error.instancePath}/${error.params.additionalProperties[0]}`,
          code: "unknown-field",
        },
      ],
    };
  }
  return {
    ok: false,
    issues: [{ path: error?.instancePath || "/", code: error?.keyword ?? "invalid" }],
  };
}

function decode(value: unknown): ModelReviewContractResult {
  if (!envelopeValidator.Check(value)) {
    return invalid(value);
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximumEnvelopeBytes) {
    return { ok: false, issues: [{ path: "/", code: "max-bytes" }] };
  }
  for (const [index, candidate] of value.payload.candidates.entries()) {
    if (!isSafeRelativePath(candidate.location.path)) {
      return {
        ok: false,
        issues: [
          { path: `/payload/candidates/${String(index)}/location/path`, code: "invalid-path" },
        ],
      };
    }
    for (const [field, text] of [
      ["ruleId", candidate.ruleId],
      ["title", candidate.title],
      ["explanation", candidate.explanation],
      ["fixGuidance", candidate.fixGuidance],
      ["suggestedTests", candidate.suggestedTests],
      ["path", candidate.location.path],
    ] as const) {
      if (!isStrictUnicode(text)) {
        return {
          ok: false,
          issues: [
            { path: `/payload/candidates/${String(index)}/${field}`, code: "invalid-unicode" },
          ],
        };
      }
    }
  }
  return { ok: true, value };
}

function isSafeRelativePath(path: string): boolean {
  return (
    !path.startsWith("/") &&
    !path.includes("\\") &&
    ![...path].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    }) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
  );
}

function isStrictUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const modelReviewCandidatesCodec = Object.freeze({
  id: "eve-reviewer.model-review-candidates",
  version: 1,
  decode,
  encode: decode,
});

export interface ModelReviewRunProvenance {
  readonly reviewRunId: string;
  readonly policyDigest: `sha256:${string}`;
  readonly target: {
    readonly targetId: string;
    readonly vendor: string;
    readonly modelId: string;
    readonly route: "direct" | "vercel-ai-gateway";
    readonly profileVersion: number;
    readonly certification: "certified" | "experimental";
    readonly upstreamProviderId?: string;
  };
  readonly evidenceSetDigest: `sha256:${string}`;
  readonly output: {
    readonly contract: { readonly id: "eve-reviewer.model-review-candidates"; readonly version: 1 };
    readonly digest: `sha256:${string}`;
    readonly byteCount: number;
  };
  readonly traceDigest: `sha256:${string}`;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
    readonly turns: number;
  };
}

export type ModelReviewOutcomeResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly recipe: { readonly id: "eve-model-review.v1"; readonly version: 1 };
        readonly run: ModelReviewRunProvenance;
        readonly outcome: AnalyzerOutcomeEnvelope;
        readonly findings: readonly (ModelReviewCandidate & {
          readonly evidence: string;
          readonly provenance: {
            readonly tool: string;
            readonly version: string;
            readonly ruleId: string;
          };
        })[];
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid-model-evidence" | "invalid-model-run";
        readonly message: string;
      };
    };

const invalidEvidence = {
  ok: false,
  error: {
    code: "invalid-model-evidence",
    message:
      "A model finding does not reference an available changed line in the captured review evidence.",
  },
} as const;

function locationKey(side: "old" | "new", path: string, line: number): string {
  return `${side}\0${path}\0${String(line)}`;
}

type ModelFileOutcome =
  | { readonly side: "old" | "new"; readonly path: string; readonly status: "analyzed" }
  | {
      readonly side: "old" | "new";
      readonly path: string;
      readonly status: "skipped";
      readonly reason: "binary" | "deleted" | "metadata-only" | "unsupported";
    };

function fallbackFileOutcome(file: {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly status: "added" | "binary" | "deleted" | "metadata-only" | "modified" | "renamed";
}): ModelFileOutcome | undefined {
  const path = file.newPath ?? file.oldPath;
  if (path === null) return undefined;
  return {
    side: file.newPath === null ? "old" : "new",
    path,
    status: "skipped",
    reason:
      file.status === "binary"
        ? "binary"
        : file.status === "deleted"
          ? "deleted"
          : file.status === "metadata-only"
            ? "metadata-only"
            : "unsupported",
  };
}

export function createModelReviewOutcome(input: {
  readonly request: ReviewRequestEnvelope | LocalReviewRequestEnvelope;
  readonly envelope: ModelReviewCandidatesEnvelope;
  readonly run: ModelReviewRunProvenance;
  readonly unavailable?: readonly {
    readonly side: "base" | "head";
    readonly path: string;
    readonly reason: "binary" | "symlink" | "gitlink";
  }[];
}): ModelReviewOutcomeResult {
  if (!isValidModelRun(input.run)) {
    return {
      ok: false,
      error: {
        code: "invalid-model-run",
        message: "The model review returned invalid managed-run provenance.",
      },
    };
  }
  const decoded = modelReviewCandidatesCodec.decode(input.envelope);
  if (!decoded.ok) return invalidEvidence;
  const serialized = JSON.stringify(decoded.value);
  if (
    input.run.output.byteCount !== Buffer.byteLength(serialized, "utf8") ||
    input.run.output.digest !==
      `sha256:${createHash("sha256").update(serialized, "utf8").digest("hex")}`
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-model-run",
        message: "The model review output does not match its receipt.",
      },
    };
  }
  const parsed = parseUnifiedDiff(input.request.payload.diff);
  if (!parsed.ok) return invalidEvidence;
  const changed = new Map(
    parsed.diff.files.flatMap((file) =>
      file.lines
        .filter((line) => line.changed)
        .map(
          (line) =>
            [
              locationKey(line.location.side, line.location.path, line.location.line),
              line.content,
            ] as const,
        ),
    ),
  );
  const sources = new Map<string, string[]>();
  for (const source of input.request.payload.sources.base) {
    sources.set(`old\0${source.path}`, source.content.split("\n"));
  }
  for (const source of input.request.payload.sources.head) {
    sources.set(`new\0${source.path}`, source.content.split("\n"));
  }
  const findings = [];
  for (const candidate of decoded.value.payload.candidates) {
    const key = locationKey(
      candidate.location.side,
      candidate.location.path,
      candidate.location.line,
    );
    const changedText = changed.get(key);
    const evidence = sources.get(`${candidate.location.side}\0${candidate.location.path}`)?.[
      candidate.location.line - 1
    ];
    if (changedText === undefined || evidence === undefined || evidence !== changedText) {
      return invalidEvidence;
    }
    findings.push({
      ...candidate,
      provenance: { tool: "eve-model-review", version: "1", ruleId: candidate.ruleId },
      evidence,
    });
  }
  const rules = [
    ...new Set(decoded.value.payload.candidates.map((candidate) => candidate.ruleId)),
  ].sort();
  const files: ModelFileOutcome[] = [
    ...input.request.payload.sources.head.map((source) => ({
      side: "new" as const,
      path: source.path,
      status: "analyzed" as const,
    })),
    ...input.request.payload.sources.base
      .filter(
        (source) => !input.request.payload.sources.head.some((head) => head.path === source.path),
      )
      .map((source) => ({
        side: "old" as const,
        path: source.path,
        status: "analyzed" as const,
      })),
    ...(input.unavailable ?? [])
      .filter(
        (entry) =>
          !input.request.payload.sources.head.some((source) => source.path === entry.path) &&
          !input.request.payload.sources.base.some((source) => source.path === entry.path),
      )
      .map((entry) => ({
        side: entry.side === "base" ? ("old" as const) : ("new" as const),
        path: entry.path,
        status: "skipped" as const,
        reason: entry.reason === "binary" ? ("binary" as const) : ("unsupported" as const),
      })),
  ];
  for (const file of parsed.diff.files) {
    if (files.some((candidate) => candidate.path === (file.newPath ?? file.oldPath))) continue;
    const fallback = fallbackFileOutcome(file);
    if (fallback !== undefined) files.push(fallback);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const analyzer = {
    tool: "eve-model-review",
    version: "1",
    profile: "eve-model-review.v1",
    rules: rules.length === 0 ? ["eve-model-review.v1"] : rules,
  };
  const rawOutcome = {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: files.some((file) => file.status === "analyzed")
      ? {
          analyzer,
          status: "analyzed" as const,
          files,
          candidates: findings.map(({ evidence: _evidence, ...candidate }) => candidate),
        }
      : {
          analyzer,
          status: "skipped" as const,
          files: files.map((file) => {
            if (file.status !== "skipped") throw new TypeError("Invalid model coverage.");
            return file;
          }),
        },
  };
  const decodedOutcome = reviewContractV1.decodeOutcome(rawOutcome);
  if (!decodedOutcome.ok) return invalidEvidence;
  const outcome = decodedOutcome.value;
  return {
    ok: true,
    value: {
      recipe: { id: "eve-model-review.v1", version: 1 },
      run: input.run,
      outcome,
      findings,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/u.test(
      value,
    )
  );
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isValidModelRun(value: unknown): value is ModelReviewRunProvenance {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "reviewRunId",
      "policyDigest",
      "target",
      "evidenceSetDigest",
      "output",
      "traceDigest",
      "usage",
    ])
  )
    return false;
  const { target, output, usage } = value;
  const text = (value: unknown) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    Buffer.byteLength(value, "utf8") <= 256;
  return (
    isUuid(value["reviewRunId"]) &&
    isDigest(value["policyDigest"]) &&
    isDigest(value["evidenceSetDigest"]) &&
    isDigest(value["traceDigest"]) &&
    isRecord(target) &&
    exactKeys(target, [
      "targetId",
      "vendor",
      "modelId",
      "route",
      "profileVersion",
      "certification",
      ...(Object.hasOwn(target, "upstreamProviderId") ? ["upstreamProviderId"] : []),
    ]) &&
    text(target["targetId"]) &&
    text(target["vendor"]) &&
    text(target["modelId"]) &&
    (target["route"] === "direct" || target["route"] === "vercel-ai-gateway") &&
    (target["certification"] === "certified" || target["certification"] === "experimental") &&
    isNonNegativeInteger(target["profileVersion"]) &&
    target["profileVersion"] > 0 &&
    (!Object.hasOwn(target, "upstreamProviderId") || text(target["upstreamProviderId"])) &&
    isRecord(output) &&
    exactKeys(output, ["contract", "digest", "byteCount"]) &&
    isRecord(output["contract"]) &&
    exactKeys(output["contract"], ["id", "version"]) &&
    output["contract"]["id"] === "eve-reviewer.model-review-candidates" &&
    output["contract"]["version"] === 1 &&
    isDigest(output["digest"]) &&
    isNonNegativeInteger(output["byteCount"]) &&
    output["byteCount"] <= 1_048_576 &&
    isRecord(usage) &&
    exactKeys(usage, ["inputTokens", "outputTokens", "reasoningTokens", "turns"]) &&
    Object.values(usage).every(isNonNegativeInteger)
  );
}

export function createModelReviewFailureOutcome(
  request: ReviewRequestEnvelope | LocalReviewRequestEnvelope,
  reason: "failed" | "invalid-output" | "evidence" = "failed",
): AnalyzerOutcomeEnvelope {
  const parsed = parseUnifiedDiff(request.payload.diff);
  const failedFiles = parsed.ok
    ? parsed.diff.files.flatMap((file) => {
        const path = file.newPath ?? file.oldPath;
        return path === null
          ? []
          : [
              {
                side: file.newPath === null ? ("old" as const) : ("new" as const),
                path,
                status: "failed" as const,
              },
            ];
      })
    : [
        ...request.payload.sources.head.map((source) => ({
          side: "new" as const,
          path: source.path,
          status: "failed" as const,
        })),
        ...request.payload.sources.base.map((source) => ({
          side: "old" as const,
          path: source.path,
          status: "failed" as const,
        })),
      ];
  return {
    kind: "eve-reviewer.analyzer-outcome",
    schemaVersion: 1,
    payload: {
      analyzer: {
        tool: "eve-model-review",
        version: "1",
        profile: "eve-model-review.v1",
        rules: ["eve-model-review.v1"],
      },
      status: "failed",
      files: failedFiles.sort((left, right) => left.path.localeCompare(right.path)),
      diagnostic: {
        code:
          reason === "invalid-output"
            ? "invalid-model-output"
            : reason === "evidence"
              ? "invalid-model-evidence"
              : "model-review-failed",
        message:
          reason === "invalid-output"
            ? "The model review returned invalid structured candidates."
            : reason === "evidence"
              ? "A model finding does not reference an available changed line in the captured review evidence."
              : "Model review did not complete; verified deterministic evidence is preserved in the failed review result.",
      },
    },
  };
}
