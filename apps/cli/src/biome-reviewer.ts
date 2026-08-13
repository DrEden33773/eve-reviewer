import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { CandidateFinding, ParsedDiff, SourceSnapshotFile } from "@eve-review-agent/core";

const require = createRequire(import.meta.url);
const biomeEntryPoint = require.resolve("@biomejs/biome/bin/biome");
const biomeRequire = createRequire(biomeEntryPoint);
const biomeVersion = (require("@biomejs/biome/package.json") as { version: string }).version;
const maximumSourceFiles = 100;
const maximumSourceBytes = 1_000_000;
const maximumSnapshotBytes = 5_000_000;
const maximumReportBytes = 10_000_000;
const supportedSourceExtensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];

interface SarifResult {
  ruleId?: unknown;
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: unknown };
      region?: { startLine?: unknown };
    };
  }>;
}

interface SarifLog {
  version?: unknown;
  runs?: Array<{ results?: SarifResult[] }>;
}

interface AnalyzerSource {
  path: string;
  content: string;
}

export type DeterministicReviewResult =
  | { ok: true; sources: SourceSnapshotFile[]; candidates: CandidateFinding[] }
  | {
      ok: false;
      error: {
        code: "invalid-source" | "analyzer-failed" | "invalid-analyzer-output";
        message: string;
      };
    };

function fail(
  code: "invalid-source" | "analyzer-failed" | "invalid-analyzer-output",
  message: string,
): DeterministicReviewResult {
  return { ok: false, error: { code, message } };
}

function supportsGlobalEvalRule(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return supportedSourceExtensions.some((extension) => lowerPath.endsWith(extension));
}

function isMuslLinux(): boolean {
  const report = process.report.getReport() as {
    header?: { glibcVersionRuntime?: unknown };
  };
  return process.platform === "linux" && report.header?.glibcVersionRuntime === undefined;
}

function resolveBiomeBinary(): string | undefined {
  const linuxSuffix = isMuslLinux() ? "-musl" : "";
  const packages: Partial<Record<NodeJS.Platform, Partial<Record<string, string>>>> = {
    linux: {
      x64: `@biomejs/cli-linux-x64${linuxSuffix}/biome`,
      arm64: `@biomejs/cli-linux-arm64${linuxSuffix}/biome`,
    },
    darwin: {
      x64: "@biomejs/cli-darwin-x64/biome",
      arm64: "@biomejs/cli-darwin-arm64/biome",
    },
    win32: {
      x64: "@biomejs/cli-win32-x64/biome.exe",
      arm64: "@biomejs/cli-win32-arm64/biome.exe",
    },
  };
  const packageName = packages[process.platform]?.[process.arch];
  if (packageName === undefined) {
    return undefined;
  }
  try {
    return biomeRequire.resolve(packageName);
  } catch {
    return undefined;
  }
}

function resolveInside(root: string, path: string): string | undefined {
  if (isAbsolute(path)) {
    return undefined;
  }
  const candidate = resolve(root, path);
  const relativePath = relative(root, candidate);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    return undefined;
  }
  return candidate;
}

function disableSourceSuppressions(source: string): string {
  return source.replaceAll(/biome-ignore(?=-|\s)/g, "biome_ignore");
}

function changedLocations(parsed: ParsedDiff): Map<string, Set<number>> {
  const locations = new Map<string, Set<number>>();
  for (const line of parsed.addedLines) {
    const lines = locations.get(line.path) ?? new Set<number>();
    lines.add(line.line);
    locations.set(line.path, lines);
  }
  return locations;
}

function loadSources(
  parsed: ParsedDiff,
  sourceRoot: string,
):
  | DeterministicReviewResult
  | { sources: SourceSnapshotFile[]; analyzerSources: AnalyzerSource[] } {
  if (parsed.filesReviewed.length > maximumSourceFiles) {
    return fail("invalid-source", `Source snapshot exceeds the ${maximumSourceFiles}-file limit.`);
  }

  const sources: SourceSnapshotFile[] = [];
  const analyzerSources: AnalyzerSource[] = [];
  let sourceRootPath: string;
  try {
    sourceRootPath = realpathSync(sourceRoot);
  } catch (error) {
    return fail(
      "invalid-source",
      `Unable to read the complete source snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let aggregateBytes = 0;
  try {
    for (const path of parsed.filesReviewed) {
      const resolvedPath = resolveInside(sourceRootPath, path);
      if (resolvedPath === undefined) {
        return fail("invalid-source", `Source path is outside the source root: ${path}.`);
      }
      const realSourcePath = realpathSync(resolvedPath);
      const relativeRealPath = relative(sourceRootPath, realSourcePath);
      if (relativeRealPath === ".." || relativeRealPath.startsWith(`..${sep}`)) {
        return fail("invalid-source", `Source path is outside the source root: ${path}.`);
      }
      const sourceStat = statSync(realSourcePath);
      if (!sourceStat.isFile()) {
        return fail("invalid-source", `Source path is not a regular file: ${path}.`);
      }
      if (sourceStat.size > maximumSourceBytes) {
        return fail(
          "invalid-source",
          `Source file exceeds the ${maximumSourceBytes}-byte limit: ${path}.`,
        );
      }
      aggregateBytes += sourceStat.size;
      if (aggregateBytes > maximumSnapshotBytes) {
        return fail(
          "invalid-source",
          `Source snapshot exceeds the ${maximumSnapshotBytes}-byte aggregate limit.`,
        );
      }
      const content = readFileSync(realSourcePath, "utf8");
      sources.push({ path, content });
      if (supportsGlobalEvalRule(path)) {
        analyzerSources.push({ path, content });
      }
    }
  } catch (error) {
    return fail(
      "invalid-source",
      `Unable to read the complete source snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { sources, analyzerSources };
}

export function reviewWithBiome(parsed: ParsedDiff, sourceRoot: string): DeterministicReviewResult {
  const loaded = loadSources(parsed, sourceRoot);
  if ("ok" in loaded) {
    return loaded;
  }
  if (loaded.analyzerSources.length === 0) {
    return { ok: true, sources: loaded.sources, candidates: [] };
  }

  const reportDirectory = mkdtempSync(join(tmpdir(), "eve-biome-review-"));
  const snapshotDirectory = join(reportDirectory, "snapshot");
  const reportPath = join(reportDirectory, "report.sarif");
  const configPath = join(reportDirectory, "biome.json");
  const analyzerPaths: string[] = [];
  const sourcePaths = new Map<string, string>();
  try {
    const biomeBinary = resolveBiomeBinary();
    if (biomeBinary === undefined) {
      return fail("analyzer-failed", "Biome review is unsupported on this platform.");
    }
    for (const source of loaded.analyzerSources) {
      const analyzerPath = resolveInside(snapshotDirectory, source.path);
      if (analyzerPath === undefined) {
        return fail("invalid-source", `Source path is outside the source root: ${source.path}.`);
      }
      mkdirSync(dirname(analyzerPath), { recursive: true });
      writeFileSync(analyzerPath, disableSourceSuppressions(source.content), "utf8");
      analyzerPaths.push(analyzerPath);
      sourcePaths.set(realpathSync(analyzerPath), source.path);
    }
    writeFileSync(
      configPath,
      JSON.stringify({
        vcs: { enabled: false },
        files: { ignoreUnknown: true, maxSize: maximumSourceBytes },
        linter: { enabled: true },
      }),
      "utf8",
    );

    const result = spawnSync(
      biomeBinary,
      [
        "lint",
        "--only=lint/security/noGlobalEval",
        `--config-path=${configPath}`,
        "--reporter=sarif",
        `--reporter-file=${reportPath}`,
        "--max-diagnostics=none",
        "--colors=off",
        ...analyzerPaths,
      ],
      { cwd: snapshotDirectory, encoding: "utf8", timeout: 5_000, windowsHide: true },
    );
    if (result.error !== undefined) {
      return fail("analyzer-failed", `Biome review failed: ${result.error.message}`);
    }
    if (result.status !== 0 && result.status !== 1) {
      return fail("analyzer-failed", `Biome review exited with status ${String(result.status)}.`);
    }

    let report: SarifLog;
    try {
      if (statSync(reportPath).size > maximumReportBytes) {
        return fail(
          "invalid-analyzer-output",
          `Biome SARIF exceeds the ${maximumReportBytes}-byte output limit.`,
        );
      }
      report = JSON.parse(readFileSync(reportPath, "utf8")) as SarifLog;
    } catch (error) {
      return fail(
        "invalid-analyzer-output",
        `Biome did not produce valid SARIF: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (report.version !== "2.1.0" || !Array.isArray(report.runs)) {
      return fail("invalid-analyzer-output", "Biome SARIF has an unsupported shape.");
    }

    const addedLocations = changedLocations(parsed);
    const reportedLocations = new Set<string>();
    const candidates: CandidateFinding[] = [];
    for (const run of report.runs) {
      for (const item of run.results ?? []) {
        if (item.ruleId !== "lint/security/noGlobalEval") {
          return fail("invalid-analyzer-output", "Biome SARIF contains a non-review diagnostic.");
        }
        const location = item.locations?.[0]?.physicalLocation;
        const uri = location?.artifactLocation?.uri;
        const line = location?.region?.startLine;
        if (typeof uri !== "string" || !Number.isSafeInteger(line) || Number(line) <= 0) {
          return fail(
            "invalid-analyzer-output",
            "Biome SARIF contains an invalid finding location.",
          );
        }
        let path: string | undefined;
        try {
          path = sourcePaths.get(realpathSync(uri));
        } catch {
          return fail(
            "invalid-analyzer-output",
            "Biome SARIF contains an unreadable file location.",
          );
        }
        if (path === undefined) {
          return fail(
            "invalid-analyzer-output",
            "Biome SARIF references a file outside the snapshot.",
          );
        }
        const findingLine = Number(line);
        if (addedLocations.get(path)?.has(findingLine) !== true) {
          continue;
        }
        const findingLocation = `${path}\0${String(findingLine)}`;
        if (reportedLocations.has(findingLocation)) {
          continue;
        }
        reportedLocations.add(findingLocation);
        candidates.push({
          ruleId: "security/no-dynamic-eval",
          severity: "critical",
          title: "Dynamic code evaluation",
          explanation: "Code added by the change evaluates text as executable code.",
          path,
          line: findingLine,
          fixGuidance: "Replace eval with an explicit parser or an allow-listed operation map.",
          suggestedTests: "Exercise hostile and malformed input and assert it is never executed.",
          confidence: 0.95,
          provenance: {
            tool: "biome",
            version: biomeVersion,
            ruleId: "lint/security/noGlobalEval",
          },
        });
      }
    }
    candidates.sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line);
    return { ok: true, sources: loaded.sources, candidates };
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}
