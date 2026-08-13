import { parseUnifiedDiff } from "./unified-diff.ts";

export { MAX_DIFF_BYTES, type ParsedDiff, parseUnifiedDiff } from "./unified-diff.ts";

export type Severity = "critical" | "high" | "medium" | "low";

export interface AnalyzerProvenance {
  tool: string;
  version: string;
  ruleId: string;
}

export interface CandidateFinding {
  ruleId: string;
  severity: Severity;
  title: string;
  explanation: string;
  path: string;
  line: number;
  fixGuidance: string;
  suggestedTests: string;
  confidence: number;
  provenance: AnalyzerProvenance;
}

export interface SourceSnapshotFile {
  path: string;
  content: string;
}

export interface ReviewFinding extends CandidateFinding {
  evidence: string;
}

export interface ValidatedReportInput {
  repository: string;
  pullRequest: number | null;
  reviewer: string;
  diff: string;
  sources?: SourceSnapshotFile[];
  candidates: CandidateFinding[];
}

export interface ReviewReport {
  repository: string;
  pullRequest: number | null;
  summary: string;
  risk: Severity | "none";
  filesReviewed: string[];
  reviewer: string;
  findings: ReviewFinding[];
}

export type ValidatedReportResult =
  | { ok: true; report: ReviewReport }
  | { ok: false; error: { code: "invalid-diff"; message: string } }
  | {
      ok: false;
      error: {
        code: "source-unavailable" | "source-mismatch";
        message: string;
        source: { path: string; line: number };
      };
    }
  | {
      ok: false;
      error: {
        code: "invalid-evidence-location";
        message: string;
        finding: Pick<CandidateFinding, "ruleId" | "path" | "line">;
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

export function buildValidatedReport(input: ValidatedReportInput): ValidatedReportResult {
  const parsed = parseUnifiedDiff(input.diff);
  if (!parsed.ok) {
    return parsed;
  }
  const addedLines = new Map(
    parsed.diff.addedLines.map((line) => [`${line.path}:${line.line}`, line]),
  );
  const sources = new Map(
    input.sources?.map((source) => [source.path, source.content.split(/\r?\n/)]) ?? [],
  );
  const findings: ReviewFinding[] = [];

  for (const candidate of input.candidates) {
    const location = `${candidate.path}:${candidate.line}`;
    if (!addedLines.has(location)) {
      return {
        ok: false,
        error: {
          code: "invalid-evidence-location",
          message: `Finding ${candidate.ruleId} references ${candidate.path}:${candidate.line}, which is not an added line.`,
          finding: {
            ruleId: candidate.ruleId,
            path: candidate.path,
            line: candidate.line,
          },
        },
      };
    }
  }

  for (const diffLine of parsed.diff.lines) {
    const source = sources.get(diffLine.path);
    if (source === undefined) {
      return {
        ok: false,
        error: {
          code: "source-unavailable",
          message: `Source snapshot is unavailable for ${diffLine.path}:${diffLine.line}.`,
          source: { path: diffLine.path, line: diffLine.line },
        },
      };
    }
    const sourceLine = source[diffLine.line - 1];
    if (sourceLine === undefined || sourceLine !== diffLine.content) {
      return {
        ok: false,
        error: {
          code: "source-mismatch",
          message: `Source snapshot does not match the diff at ${diffLine.path}:${diffLine.line}.`,
          source: { path: diffLine.path, line: diffLine.line },
        },
      };
    }
  }

  for (const candidate of input.candidates) {
    const sourceLine = sources.get(candidate.path)?.[candidate.line - 1] ?? "";
    findings.push({
      ruleId: candidate.ruleId,
      severity: candidate.severity,
      title: candidate.title,
      explanation: candidate.explanation,
      path: candidate.path,
      line: candidate.line,
      evidence: sourceLine,
      fixGuidance: candidate.fixGuidance,
      suggestedTests: candidate.suggestedTests,
      confidence: candidate.confidence,
      provenance: candidate.provenance,
    });
  }

  const risk = highestSeverity(input.candidates);
  const findingLabel = input.candidates.length === 1 ? "finding" : "findings";
  const fileLabel = parsed.diff.filesReviewed.length === 1 ? "file" : "files";

  return {
    ok: true,
    report: {
      repository: input.repository,
      pullRequest: input.pullRequest,
      summary: `${input.candidates.length} ${findingLabel} across ${parsed.diff.filesReviewed.length} changed ${fileLabel}; highest severity: ${risk}.`,
      risk,
      filesReviewed: parsed.diff.filesReviewed,
      reviewer: input.reviewer,
      findings,
    },
  };
}
