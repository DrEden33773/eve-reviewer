import { isAbsolute, normalize, sep } from "node:path";

import { parsePatch } from "diff";

export interface AddedLine {
  path: string;
  line: number;
  content: string;
}

export interface DiffLine extends AddedLine {
  added: boolean;
}

export interface ParsedDiff {
  filesReviewed: string[];
  addedLines: AddedLine[];
  lines: DiffLine[];
}

export type DiffParseResult =
  | { ok: true; diff: ParsedDiff }
  | { ok: false; error: { code: "invalid-diff"; message: string } };

export const MAX_DIFF_BYTES = 1_000_000;
const MAX_ADDED_LINES = 10_000;
const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function malformed(message: string): DiffParseResult {
  return { ok: false, error: { code: "invalid-diff", message } };
}

function validateHunkCoordinates(source: string): DiffParseResult | undefined {
  for (const line of source.split("\n")) {
    if (!line.startsWith("@@ ")) {
      continue;
    }
    const match = hunkHeader.exec(line);
    if (match?.[1] === undefined || match[3] === undefined) {
      return malformed("Malformed unified diff: invalid hunk header.");
    }
    const values = [match[1], match[2] ?? "1", match[3], match[4] ?? "1"].map((value) =>
      BigInt(value),
    );
    if (values.some((value) => value > maximumSafeInteger)) {
      return malformed("Malformed unified diff: hunk header values must be safe integers.");
    }
    const [oldStart, oldCount, newStart, newCount] = values;
    if (
      oldStart === undefined ||
      oldCount === undefined ||
      newStart === undefined ||
      newCount === undefined
    ) {
      return malformed("Malformed unified diff: invalid hunk header.");
    }
    const oldEnd = oldStart + (oldCount > 0n ? oldCount - 1n : 0n);
    const newEnd = newStart + (newCount > 0n ? newCount - 1n : 0n);
    if (oldEnd > maximumSafeInteger || newEnd > maximumSafeInteger) {
      return malformed("Malformed unified diff: hunk ranges must use safe integers.");
    }
  }
  return undefined;
}

function normalizePath(value: string | undefined): string | undefined {
  if (value === undefined || value === "/dev/null") {
    return undefined;
  }
  return value.startsWith("b/") ? value.slice(2) : value;
}

function isSafeSnapshotPath(path: string): boolean {
  const normalized = normalize(path);
  return (
    !isAbsolute(path) &&
    path !== "" &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    normalized !== ".." &&
    !normalized.startsWith(`..${sep}`) &&
    normalized !== "."
  );
}

function parseFailure(error: unknown): DiffParseResult {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("line count did not match") ||
    message.includes("has more lines than expected")
  ) {
    return malformed("Malformed unified diff: hunk line counts do not match its header.");
  }
  return malformed(`Malformed unified diff: ${message}`);
}

function hunkContent(rawLine: string): string {
  const content = rawLine.slice(1);
  return content.endsWith("\r") ? content.slice(0, -1) : content;
}

export function parseUnifiedDiff(source: string): DiffParseResult {
  if (Buffer.byteLength(source, "utf8") > MAX_DIFF_BYTES) {
    return malformed(`Diff exceeds the ${MAX_DIFF_BYTES}-byte input limit.`);
  }
  const unsafeCoordinates = validateHunkCoordinates(source);
  if (unsafeCoordinates !== undefined) {
    return unsafeCoordinates;
  }

  let patches: ReturnType<typeof parsePatch>;
  try {
    patches = parsePatch(source);
  } catch (error) {
    return parseFailure(error);
  }
  if (patches.length === 0) {
    return malformed("Malformed unified diff: no reviewable file was found.");
  }

  const filesReviewed: string[] = [];
  const reviewedFileSet = new Set<string>();
  const addedLines: AddedLine[] = [];
  const lines: DiffLine[] = [];

  for (const patch of patches) {
    const path = normalizePath(patch.newFileName) ?? normalizePath(patch.oldFileName);
    if (path === undefined) {
      return malformed("Malformed unified diff: a changed file has no usable path.");
    }
    if (!isSafeSnapshotPath(path)) {
      return malformed(
        "Malformed unified diff: changed paths must stay inside the source snapshot.",
      );
    }
    if (!reviewedFileSet.has(path)) {
      reviewedFileSet.add(path);
      filesReviewed.push(path);
    }
    for (const hunk of patch.hunks) {
      let nextNewLine = hunk.newStart;
      for (const rawLine of hunk.lines) {
        if (rawLine.startsWith("+")) {
          if (addedLines.length === MAX_ADDED_LINES) {
            return malformed(`Diff exceeds the ${MAX_ADDED_LINES}-added-line limit.`);
          }
          const addedLine = { path, line: nextNewLine, content: hunkContent(rawLine) };
          addedLines.push(addedLine);
          lines.push({ ...addedLine, added: true });
          nextNewLine += 1;
        } else if (rawLine.startsWith(" ")) {
          lines.push({ path, line: nextNewLine, content: hunkContent(rawLine), added: false });
          nextNewLine += 1;
        } else if (!rawLine.startsWith("-") && !rawLine.startsWith("\\ No newline")) {
          return malformed("Malformed unified diff: invalid hunk body line.");
        }
      }
    }
  }

  return { ok: true, diff: { filesReviewed, addedLines, lines } };
}
