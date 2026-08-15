import {
  type ChangedFile,
  type ChangedFileStatus,
  type DiffSide,
  type EvidenceLocation,
  type ParsedDiff,
  parseUnifiedDiff,
} from "./unified-diff.ts";

export {
  createInMemoryReviewAdapter,
  type InMemoryReviewAdapterDependencies,
  type InMemoryReviewPort,
} from "./in-memory-adapter.ts";
export {
  type AnalyzerOutcomeEnvelope,
  type ContractIssue,
  type ContractRejection,
  type DecodeAnalyzerOutcomeResult,
  type DecodeReviewRequestResult,
  type DecodeReviewResultResult,
  type EncodeReviewResultResult,
  type ReviewRequestEnvelope,
  type ReviewResultEnvelope,
  reviewContractV1,
} from "./review-contract.ts";

import {
  type AnalyzerOutcomeEnvelope,
  type ReviewRequestEnvelope,
  type ReviewResultEnvelope,
  reviewContractV1,
} from "./review-contract.ts";

export {
  type ChangedFile,
  type ChangedFileStatus,
  type DiffLine,
  type DiffSide,
  type EvidenceLocation,
  MAX_DIFF_BYTES,
  type ParsedDiff,
  parseUnifiedDiff,
} from "./unified-diff.ts";

export type Severity = "critical" | "high" | "medium" | "low";

export interface AnalyzerProvenance {
  tool: string;
  version: string;
  ruleId: string;
}

export interface AnalyzerDescriptor {
  tool: string;
  version: string;
  profile: string;
  rules: string[];
}

export interface AnalyzerLimits {
  maximumSourceFiles: number;
  maximumSourceFileBytes: number;
  maximumSnapshotBytes: number;
  maximumStdoutBytes: number;
  maximumStderrBytes: number;
  maximumReportBytes: number;
  terminationGraceMilliseconds: number;
}

export interface AnalyzerContext {
  signal: AbortSignal;
  deadline: number;
  limits: AnalyzerLimits;
}

export interface CandidateFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  explanation: string;
  location: EvidenceLocation;
  fixGuidance: string;
  suggestedTests: string;
  confidence: number;
  provenance: AnalyzerProvenance;
}

export interface SourceSnapshotFile {
  path: string;
  content: string;
}

export interface ReviewSources {
  base: SourceSnapshotFile[];
  head: SourceSnapshotFile[];
}

export interface AnalyzedFile {
  side: DiffSide;
  path: string;
}

export interface ReviewFinding extends CandidateFinding {
  evidence: string;
}

export type SourceAvailability = "available" | "unavailable" | "not-applicable";

export type FileAnalysisCoverage =
  | { status: "analyzed"; side: DiffSide }
  | {
      status: "not-analyzed";
      reason: "binary" | "deleted" | "metadata-only" | "source-unavailable" | "unsupported";
    };

export interface FileCoverage {
  oldPath: string | null;
  newPath: string | null;
  status: ChangedFileStatus;
  baseSource: SourceAvailability;
  headSource: SourceAvailability;
  analysis: FileAnalysisCoverage;
}

export type ReportCoverageStatus = "complete" | "partial" | "no-coverage";

export interface ReviewCoverage {
  status: ReportCoverageStatus;
  files: FileCoverage[];
}

export interface ValidatedReportInput {
  repository: string;
  pullRequest: number | null;
  reviewer: string;
  diff: string;
  sources: ReviewSources;
  analyzedFiles: AnalyzedFile[];
  candidates: CandidateFinding[];
}

export interface ReviewReport {
  repository: string;
  pullRequest: number | null;
  summary: string;
  risk: Severity | "none";
  coverage: ReviewCoverage;
  reviewer: string;
  findings: ReviewFinding[];
}

export interface AnalyzerExecutionInput {
  profile: string;
  rules: string[];
  sources: SourceSnapshotFile[];
}

export interface AnalyzerExecutionSuccess {
  ok: true;
  version: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  artifacts?: Array<{ uri: string; path: string }>;
  report: string;
}

export interface AnalyzerExecutionStartFailure {
  ok: false;
  failure: "start";
  version: string;
  message: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionFailure {
  ok: false;
  failure: "execution";
  version: string;
  exitCode: number | null;
  message: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionCancellation {
  ok: false;
  failure: "cancelled";
  version: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionDeadline {
  ok: false;
  failure: "deadline";
  version: string;
  cleanupIncomplete?: true;
}

export interface AnalyzerExecutionCleanupFailure {
  ok: false;
  failure: "cleanup";
  version: string;
}

export type AnalyzerLimitedResource = "stdout" | "stderr" | "report";

export interface AnalyzerExecutionLimitFailure {
  ok: false;
  failure: "limit";
  resource: AnalyzerLimitedResource;
  version: string;
  cleanupIncomplete?: true;
}

export type AnalyzerExecutionResult =
  | AnalyzerExecutionSuccess
  | AnalyzerExecutionStartFailure
  | AnalyzerExecutionFailure
  | AnalyzerExecutionCancellation
  | AnalyzerExecutionDeadline
  | AnalyzerExecutionCleanupFailure
  | AnalyzerExecutionLimitFailure;

export type ExecuteAnalyzer = (
  input: AnalyzerExecutionInput,
  context: AnalyzerContext,
) => Promise<AnalyzerExecutionResult>;

export type ValidatedReportResult =
  | { ok: true; report: ReviewReport }
  | { ok: false; error: { code: "invalid-diff"; message: string } }
  | { ok: false; error: { code: "invalid-source"; message: string } }
  | {
      ok: false;
      error: {
        code: "source-unavailable" | "source-mismatch";
        message: string;
        source: EvidenceLocation;
      };
    }
  | {
      ok: false;
      error: {
        code: "invalid-evidence-location";
        message: string;
        finding: Pick<CandidateFinding, "ruleId" | "location">;
      };
    };

function highestSeverity(candidates: CandidateFinding[]): Severity | "none" {
  const severityOrder: Array<Severity | "none"> = ["none", "low", "medium", "high", "critical"];
  let highest: Severity | "none" = "none";

  for (const candidate of candidates) {
    if (severityOrder.indexOf(candidate.severity) > severityOrder.indexOf(highest)) {
      highest = candidate.severity;
    }
  }

  return highest;
}

function locationKey(location: Pick<EvidenceLocation, "side" | "path" | "line">): string {
  return `${location.side}\0${location.path}\0${String(location.line)}`;
}

function sourceKey(side: DiffSide, path: string): string {
  return `${side}\0${path}`;
}

type SourceMapResult =
  | { ok: true; sources: Map<string, string[]> }
  | { ok: false; error: { code: "invalid-source"; message: string } };

const MAX_SOURCE_FILE_BYTES = 1_000_000;
const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_SNAPSHOT_BYTES = 5_000_000;

function tightenedLimit(requested: number, maximum: number): number {
  if (Number.isNaN(requested) || requested <= 0) {
    return 0;
  }
  if (!Number.isFinite(requested)) {
    return maximum;
  }
  return Math.min(Math.floor(requested), maximum);
}

function sourceMap(
  sources: ReviewSources,
  files: ChangedFile[],
  limits: {
    maximumSourceFiles: number;
    maximumSourceFileBytes: number;
    maximumSnapshotBytes: number;
  } = {
    maximumSourceFiles: MAX_SOURCE_FILES,
    maximumSourceFileBytes: MAX_SOURCE_FILE_BYTES,
    maximumSnapshotBytes: MAX_SOURCE_SNAPSHOT_BYTES,
  },
): SourceMapResult {
  const result = new Map<string, string[]>();
  const oldPaths = new Set(files.flatMap((file) => (file.oldPath === null ? [] : [file.oldPath])));
  const newPaths = new Set(files.flatMap((file) => (file.newPath === null ? [] : [file.newPath])));
  for (const [label, side, snapshot, changedPaths] of [
    ["Base", "old", sources.base, oldPaths],
    ["Head", "new", sources.head, newPaths],
  ] as const) {
    if (snapshot.length > limits.maximumSourceFiles) {
      return {
        ok: false,
        error: {
          code: "invalid-source",
          message: `${label} source snapshot exceeds the ${limits.maximumSourceFiles}-file limit.`,
        },
      };
    }
    let aggregateBytes = 0;
    for (const source of snapshot) {
      if (!changedPaths.has(source.path)) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source path is not present on the ${side} side of the change: ${source.path}.`,
          },
        };
      }
      const sourceBytes = Buffer.byteLength(source.content, "utf8");
      if (sourceBytes > limits.maximumSourceFileBytes) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source file exceeds the ${limits.maximumSourceFileBytes}-byte limit: ${source.path}.`,
          },
        };
      }
      aggregateBytes += sourceBytes;
      if (aggregateBytes > limits.maximumSnapshotBytes) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source snapshot exceeds the ${limits.maximumSnapshotBytes}-byte aggregate limit.`,
          },
        };
      }
      const key = sourceKey(side, source.path);
      if (result.has(key)) {
        return {
          ok: false,
          error: {
            code: "invalid-source",
            message: `${label} source snapshot contains duplicate path: ${source.path}.`,
          },
        };
      }
      result.set(key, source.content.split(/\r?\n/));
    }
  }
  return { ok: true, sources: result };
}

function pathForSide(file: ChangedFile, side: DiffSide): string | null {
  return side === "old" ? file.oldPath : file.newPath;
}

function availability(
  path: string | null,
  side: DiffSide,
  sources: Map<string, string[]>,
): SourceAvailability {
  if (path === null) {
    return "not-applicable";
  }
  return sources.has(sourceKey(side, path)) ? "available" : "unavailable";
}

function coverageForFile(
  file: ChangedFile,
  sources: Map<string, string[]>,
  analyzedFiles: AnalyzedFile[],
): FileCoverage {
  const baseSource = availability(file.oldPath, "old", sources);
  const headSource = availability(file.newPath, "new", sources);
  const analyzed = analyzedFiles.find((entry) => pathForSide(file, entry.side) === entry.path);
  const hasChangedLines = file.lines.some((line) => line.changed);

  let analysis: FileAnalysisCoverage;
  if (file.status === "binary") {
    analysis = { status: "not-analyzed", reason: "binary" };
  } else if (file.status === "deleted" && !hasChangedLines) {
    analysis = { status: "not-analyzed", reason: "deleted" };
  } else if (!hasChangedLines) {
    analysis = { status: "not-analyzed", reason: "metadata-only" };
  } else if (analyzed !== undefined && sources.has(sourceKey(analyzed.side, analyzed.path))) {
    analysis = { status: "analyzed", side: analyzed.side };
  } else if (analyzed !== undefined) {
    analysis = { status: "not-analyzed", reason: "source-unavailable" };
  } else if (file.status === "deleted") {
    analysis = { status: "not-analyzed", reason: "deleted" };
  } else if (file.newPath !== null && headSource === "unavailable") {
    analysis = { status: "not-analyzed", reason: "source-unavailable" };
  } else {
    analysis = { status: "not-analyzed", reason: "unsupported" };
  }

  return {
    oldPath: file.oldPath,
    newPath: file.newPath,
    status: file.status,
    baseSource,
    headSource,
    analysis,
  };
}

function reportCoverage(files: FileCoverage[]): ReportCoverageStatus {
  const analyzedFiles = files.filter((file) => file.analysis.status === "analyzed").length;
  if (analyzedFiles === files.length) {
    return "complete";
  }
  return analyzedFiles === 0 ? "no-coverage" : "partial";
}

function reviewSummary(
  findingCount: number,
  fileCount: number,
  coverage: ReportCoverageStatus,
  risk: Severity | "none",
): string {
  const findingLabel = findingCount === 1 ? "finding" : "findings";
  const fileLabel = fileCount === 1 ? "file" : "files";
  return `${String(findingCount)} ${findingLabel} across ${String(fileCount)} changed ${fileLabel}; coverage: ${coverage}; highest severity: ${risk}.`;
}

function sourceConsistencyError(
  diff: ParsedDiff,
  sources: Map<string, string[]>,
):
  | {
      code: "source-mismatch";
      message: string;
      source: EvidenceLocation;
    }
  | undefined {
  for (const file of diff.files) {
    for (const diffLine of file.lines) {
      const source = sources.get(sourceKey(diffLine.location.side, diffLine.location.path));
      if (source === undefined) {
        continue;
      }
      const sourceLine = source[diffLine.location.line - 1];
      if (sourceLine === undefined || sourceLine !== diffLine.content) {
        const { side, path, line } = diffLine.location;
        return {
          code: "source-mismatch",
          message: `Source snapshot does not match the diff at ${side} ${path}:${String(line)}.`,
          source: diffLine.location,
        };
      }
    }
  }
  return undefined;
}

function buildValidatedReportFromParsedDiff(
  input: Omit<ValidatedReportInput, "diff">,
  diff: ParsedDiff,
): ValidatedReportResult {
  const changedLocations = new Set(
    diff.files.flatMap((file) =>
      file.lines.filter((line) => line.changed).map((line) => locationKey(line.location)),
    ),
  );
  const mappedSources = sourceMap(input.sources, diff.files);
  if (!mappedSources.ok) {
    return mappedSources;
  }
  const sources = mappedSources.sources;

  for (const candidate of input.candidates) {
    if (!changedLocations.has(locationKey(candidate.location))) {
      const { side, path, line } = candidate.location;
      return {
        ok: false,
        error: {
          code: "invalid-evidence-location",
          message: `Finding ${candidate.ruleId} references ${side} ${path}:${String(line)}, which is not a changed line on that side.`,
          finding: { ruleId: candidate.ruleId, location: candidate.location },
        },
      };
    }
  }

  const mismatch = sourceConsistencyError(diff, sources);
  if (mismatch !== undefined) {
    return { ok: false, error: mismatch };
  }

  const findings: ReviewFinding[] = [];
  for (const candidate of input.candidates) {
    const source = sources.get(sourceKey(candidate.location.side, candidate.location.path));
    const sourceLine = source?.[candidate.location.line - 1];
    if (sourceLine === undefined) {
      const { side, path, line } = candidate.location;
      return {
        ok: false,
        error: {
          code: "source-unavailable",
          message: `Source snapshot is unavailable for ${side} ${path}:${String(line)}.`,
          source: candidate.location,
        },
      };
    }
    findings.push({ ...candidate, evidence: sourceLine });
  }

  const files = diff.files.map((file) => coverageForFile(file, sources, input.analyzedFiles));
  const coverageStatus = reportCoverage(files);
  const risk = highestSeverity(input.candidates);

  return {
    ok: true,
    report: {
      repository: input.repository,
      pullRequest: input.pullRequest,
      summary: reviewSummary(input.candidates.length, files.length, coverageStatus, risk),
      risk,
      coverage: { status: coverageStatus, files },
      reviewer: input.reviewer,
      findings,
    },
  };
}

export function buildValidatedReport(input: ValidatedReportInput): ValidatedReportResult {
  const parsed = parseUnifiedDiff(input.diff);
  if (!parsed.ok) {
    return parsed;
  }
  return buildValidatedReportFromParsedDiff(input, parsed.diff);
}

export interface AnalyzeReviewInput {
  subject: ReviewRequestEnvelope["payload"]["subject"];
  reviewer: string;
  diff: ParsedDiff;
  sources: ReviewSources;
}

export type AnalyzeReview = (
  input: AnalyzeReviewInput,
  context: AnalyzerContext,
) => Promise<unknown[]>;

export interface ReviewUseCase {
  review(request: unknown, context: AnalyzerContext): Promise<ReviewResultEnvelope>;
}

type ReviewFailureError = Extract<ReviewResultEnvelope["payload"], { ok: false }>["error"];

function versionedReviewFailure(error: ReviewFailureError): ReviewResultEnvelope {
  return {
    kind: "eve-reviewer.review-result" as const,
    schemaVersion: 1 as const,
    payload: { ok: false as const, error },
  } as ReviewResultEnvelope;
}

function outcomeMatchesFile(
  outcomeFile: AnalyzerOutcomeEnvelope["payload"]["files"][number],
  coverage: Pick<FileCoverage, "oldPath" | "newPath">,
): boolean {
  return outcomeFile.side === "old"
    ? coverage.oldPath === outcomeFile.path
    : coverage.newPath === outcomeFile.path;
}

function analyzerIdentity(analyzer: AnalyzerDescriptor): string {
  return JSON.stringify([analyzer.tool, analyzer.version, analyzer.profile, analyzer.rules]);
}

function compareAnalyzerIdentity(
  left: AnalyzerOutcomeEnvelope,
  right: AnalyzerOutcomeEnvelope,
): number {
  const leftIdentity = analyzerIdentity(left.payload.analyzer);
  const rightIdentity = analyzerIdentity(right.payload.analyzer);
  return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
}

function matrixCoverageStatus(
  files: Array<{ analyses: Array<{ status: "analyzed" | "skipped" | "failed" }> }>,
): ReportCoverageStatus {
  const analyses = files.flatMap((file) => file.analyses);
  const analyzed = analyses.filter((analysis) => analysis.status === "analyzed").length;
  if (
    files.length > 0 &&
    files.every((file) => file.analyses.length > 0) &&
    analyzed === analyses.length
  ) {
    return "complete";
  }
  return analyzed === 0 ? "no-coverage" : "partial";
}

export function createReviewUseCase(dependencies: {
  analyze: AnalyzeReview;
  clock: () => number;
}): ReviewUseCase {
  return {
    async review(request: unknown, context: AnalyzerContext) {
      const decoded = reviewContractV1.decodeRequest(request);
      if (!decoded.ok) {
        return versionedReviewFailure(decoded.error);
      }
      if (context.signal.aborted) {
        return versionedReviewFailure({ code: "cancelled", stage: "start" });
      }
      if (dependencies.clock() >= context.deadline) {
        return versionedReviewFailure({ code: "deadline-exceeded", stage: "start" });
      }
      const parsed = parseUnifiedDiff(decoded.value.payload.diff);
      if (!parsed.ok) {
        return versionedReviewFailure(parsed.error);
      }
      const validatedSources = sourceMap(decoded.value.payload.sources, parsed.diff.files, {
        maximumSourceFiles: tightenedLimit(context.limits.maximumSourceFiles, MAX_SOURCE_FILES),
        maximumSourceFileBytes: tightenedLimit(
          context.limits.maximumSourceFileBytes,
          MAX_SOURCE_FILE_BYTES,
        ),
        maximumSnapshotBytes: tightenedLimit(
          context.limits.maximumSnapshotBytes,
          MAX_SOURCE_SNAPSHOT_BYTES,
        ),
      });
      if (!validatedSources.ok) {
        return versionedReviewFailure(validatedSources.error);
      }
      const mismatch = sourceConsistencyError(parsed.diff, validatedSources.sources);
      if (mismatch !== undefined) {
        return versionedReviewFailure(mismatch);
      }
      if (context.signal.aborted) {
        return versionedReviewFailure({ code: "cancelled", stage: "start" });
      }
      if (dependencies.clock() >= context.deadline) {
        return versionedReviewFailure({ code: "deadline-exceeded", stage: "start" });
      }

      let rawOutcomes: unknown;
      try {
        const analyzerInput = structuredClone({
          subject: decoded.value.payload.subject,
          reviewer: decoded.value.payload.reviewer,
          diff: parsed.diff,
          sources: decoded.value.payload.sources,
        });
        rawOutcomes = await dependencies.analyze(analyzerInput, {
          signal: context.signal,
          deadline: context.deadline,
          limits: { ...context.limits },
        });
      } catch {
        return versionedReviewFailure({
          code: "analyzer-execution-failed",
          stage: "analyze",
          message: "The analyzer Adapter did not complete successfully.",
        });
      }
      if (context.signal.aborted) {
        return versionedReviewFailure({ code: "cancelled", stage: "analyze" });
      }
      if (dependencies.clock() >= context.deadline) {
        return versionedReviewFailure({ code: "deadline-exceeded", stage: "analyze" });
      }
      if (!Array.isArray(rawOutcomes)) {
        return versionedReviewFailure({
          code: "invalid-contract",
          stage: "decode-outcome",
          issues: [{ path: "/", code: "array" }],
        });
      }
      if (rawOutcomes.length > 100) {
        return versionedReviewFailure({
          code: "invalid-contract",
          stage: "decode-outcome",
          issues: [{ path: "/", code: "max-items" }],
        });
      }

      const outcomes: AnalyzerOutcomeEnvelope[] = [];
      const analyzerIdentities = new Set<string>();
      for (const [outcomeIndex, rawOutcome] of rawOutcomes.entries()) {
        const decodedOutcome = reviewContractV1.decodeOutcome(rawOutcome);
        if (!decodedOutcome.ok) {
          return versionedReviewFailure(decodedOutcome.error);
        }
        const outcome = structuredClone(decodedOutcome.value);
        const identity = analyzerIdentity(outcome.payload.analyzer);
        if (analyzerIdentities.has(identity)) {
          return versionedReviewFailure({
            code: "invalid-contract",
            stage: "decode-outcome",
            issues: [
              {
                path: `/${String(outcomeIndex)}/payload/analyzer`,
                code: "duplicate",
              },
            ],
          });
        }
        analyzerIdentities.add(identity);
        const classifiedFiles = new Set<number>();
        for (const [fileIndex, outcomeFile] of outcome.payload.files.entries()) {
          const matchingFiles = parsed.diff.files.flatMap((file, index) =>
            pathForSide(file, outcomeFile.side) === outcomeFile.path ? [index] : [],
          );
          const matchingFile = matchingFiles[0];
          if (
            matchingFiles.length !== 1 ||
            matchingFile === undefined ||
            classifiedFiles.has(matchingFile)
          ) {
            return versionedReviewFailure({
              code: "invalid-contract",
              stage: "decode-outcome",
              issues: [
                {
                  path: `/${String(outcomeIndex)}/payload/files/${String(fileIndex)}/path`,
                  code: "mismatch",
                },
              ],
            });
          }
          classifiedFiles.add(matchingFile);
        }
        outcomes.push(outcome);
      }
      if (outcomes.length === 0) {
        return versionedReviewFailure({
          code: "invalid-contract",
          stage: "decode-outcome",
          issues: [{ path: "/", code: "min-items" }],
        });
      }

      const orderedOutcomes = outcomes.toSorted(compareAnalyzerIdentity);
      const candidateCount = orderedOutcomes.reduce(
        (count, outcome) =>
          count + (outcome.payload.status === "analyzed" ? outcome.payload.candidates.length : 0),
        0,
      );
      if (candidateCount > 1_000) {
        return versionedReviewFailure({
          code: "invalid-contract",
          stage: "decode-outcome",
          issues: [{ path: "/", code: "max-items" }],
        });
      }
      const terminalOutcome = orderedOutcomes.find(
        (outcome) =>
          outcome.payload.status === "failed" &&
          (outcome.payload.diagnostic.code === "cancelled" ||
            outcome.payload.diagnostic.code === "deadline-exceeded"),
      );
      if (terminalOutcome?.payload.status === "failed") {
        return versionedReviewFailure({
          code: terminalOutcome.payload.diagnostic.code as "cancelled" | "deadline-exceeded",
          stage: "analyze",
          ...(terminalOutcome.payload.diagnostic.cleanupIncomplete
            ? { cleanupIncomplete: true as const }
            : {}),
        });
      }

      const analyzedFiles = orderedOutcomes.flatMap((outcome) =>
        outcome.payload.status === "analyzed"
          ? outcome.payload.files.flatMap((file) =>
              file.status === "analyzed" ? [{ side: file.side, path: file.path }] : [],
            )
          : [],
      );
      const diffLocationOrder = new Map(
        parsed.diff.files
          .flatMap((file) => file.lines.filter((line) => line.changed))
          .map((line, index) => [locationKey(line.location), index]),
      );
      const candidates = orderedOutcomes
        .flatMap((outcome, analyzerOrder) =>
          outcome.payload.status === "analyzed"
            ? outcome.payload.candidates.map((candidate, candidateOrder) => ({
                candidate,
                analyzerOrder,
                candidateOrder,
              }))
            : [],
        )
        .toSorted((left, right) => {
          const leftLocation = diffLocationOrder.get(locationKey(left.candidate.location));
          const rightLocation = diffLocationOrder.get(locationKey(right.candidate.location));
          return (
            (leftLocation ?? Number.MAX_SAFE_INTEGER) -
              (rightLocation ?? Number.MAX_SAFE_INTEGER) ||
            left.analyzerOrder - right.analyzerOrder ||
            left.candidateOrder - right.candidateOrder
          );
        })
        .map(({ candidate }) => candidate);
      const built = buildValidatedReport({
        repository: decoded.value.payload.subject.repository,
        pullRequest: decoded.value.payload.subject.number,
        reviewer: decoded.value.payload.reviewer,
        diff: decoded.value.payload.diff,
        sources: decoded.value.payload.sources,
        analyzedFiles,
        candidates,
      });
      if (!built.ok) {
        return versionedReviewFailure(built.error);
      }

      const files = built.report.coverage.files.map(({ analysis: _analysis, ...file }) => ({
        ...file,
        analyses: orderedOutcomes.flatMap((outcome) =>
          outcome.payload.files
            .filter((outcomeFile) => outcomeMatchesFile(outcomeFile, file))
            .map((outcomeFile) =>
              outcomeFile.status === "skipped"
                ? {
                    analyzer: outcome.payload.analyzer,
                    status: outcomeFile.status,
                    reason: outcomeFile.reason,
                    side: outcomeFile.side,
                  }
                : {
                    analyzer: outcome.payload.analyzer,
                    status: outcomeFile.status,
                    side: outcomeFile.side,
                  },
            ),
        ),
      }));
      const coverage = { status: matrixCoverageStatus(files), files };
      const analyzers = orderedOutcomes.map((outcome) => outcome.payload.analyzer);
      const diagnostics = orderedOutcomes.flatMap((outcome) =>
        outcome.payload.status === "failed"
          ? [{ analyzer: outcome.payload.analyzer, ...outcome.payload.diagnostic }]
          : [],
      );

      if (diagnostics.length > 0) {
        return {
          kind: "eve-reviewer.review-result" as const,
          schemaVersion: 1 as const,
          payload: {
            ok: false as const,
            error: { code: "required-analyzer-failed" as const, stage: "analyze" as const },
            partial: {
              coverage,
              analyzers,
              diagnostics,
              findings: built.report.findings,
            },
          },
        };
      }

      return {
        kind: "eve-reviewer.review-result" as const,
        schemaVersion: 1 as const,
        payload: {
          ok: true as const,
          report: {
            subject: decoded.value.payload.subject,
            reviewer: built.report.reviewer,
            summary: reviewSummary(
              built.report.findings.length,
              coverage.files.length,
              coverage.status,
              built.report.risk,
            ),
            risk: built.report.risk,
            coverage,
            analyzers,
            diagnostics,
            findings: built.report.findings,
          },
        },
      };
    },
  };
}
