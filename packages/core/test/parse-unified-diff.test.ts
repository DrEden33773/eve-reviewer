import assert from "node:assert/strict";
import test from "node:test";

import { parseUnifiedDiff } from "../src/index.ts";

test("normalizes old and new paths with side-aware hunk line coordinates", () => {
  const result = parseUnifiedDiff(
    [
      "diff --git a/src/config.ts b/src/config.ts",
      "--- a/src/config.ts",
      "+++ b/src/config.ts",
      "@@ -4,2 +4,2 @@",
      " keep();",
      "-oldValue();",
      "+newValue();",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "src/config.ts",
          newPath: "src/config.ts",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "src/config.ts", line: 4 },
              content: "keep();",
              changed: false,
            },
            {
              location: { side: "new", path: "src/config.ts", line: 4 },
              content: "keep();",
              changed: false,
            },
            {
              location: { side: "old", path: "src/config.ts", line: 5 },
              content: "oldValue();",
              changed: true,
            },
            {
              location: { side: "new", path: "src/config.ts", line: 5 },
              content: "newValue();",
              changed: true,
            },
          ],
        },
      ],
    },
  });
});

test("classifies a deletion without retaining the old diff prefix", () => {
  const result = parseUnifiedDiff(
    [
      "diff --git a/src/obsolete.ts b/src/obsolete.ts",
      "deleted file mode 100644",
      "--- a/src/obsolete.ts",
      "+++ /dev/null",
      "@@ -7 +0,0 @@",
      "-removeMe();",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "src/obsolete.ts",
          newPath: null,
          status: "deleted",
          lines: [
            {
              location: { side: "old", path: "src/obsolete.ts", line: 7 },
              content: "removeMe();",
              changed: true,
            },
          ],
        },
      ],
    },
  });
});

test("classifies an empty-file deletion from Git metadata", () => {
  const result = parseUnifiedDiff(
    [
      "diff --git a/src/empty.ts b/src/empty.ts",
      "deleted file mode 100644",
      "index e69de29..0000000",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "src/empty.ts",
          newPath: null,
          status: "deleted",
          lines: [],
        },
      ],
    },
  });
});

test("classifies a rename and decodes quoted old and new paths", () => {
  const result = parseUnifiedDiff(
    [
      'diff --git "a/docs/old name.ts" "b/docs/new name.ts"',
      "similarity index 100%",
      "rename from docs/old name.ts",
      "rename to docs/new name.ts",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "docs/old name.ts",
          newPath: "docs/new name.ts",
          status: "renamed",
          lines: [],
        },
      ],
    },
  });
});

test("classifies an added file with only a new path", () => {
  const result = parseUnifiedDiff(
    [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+created();",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: null,
          newPath: "src/new.ts",
          status: "added",
          lines: [
            {
              location: { side: "new", path: "src/new.ts", line: 1 },
              content: "created();",
              changed: true,
            },
          ],
        },
      ],
    },
  });
});

test("classifies a binary patch without inventing text lines", () => {
  const result = parseUnifiedDiff(
    [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1234567..89abcde 100644",
      "Binary files a/assets/logo.png and b/assets/logo.png differ",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "assets/logo.png",
          newPath: "assets/logo.png",
          status: "binary",
          lines: [],
        },
      ],
    },
  });
});

test("classifies a Git binary patch without inventing text lines", () => {
  const result = parseUnifiedDiff(
    [
      "diff --git a/assets/logo.png b/assets/logo.png",
      "index 1111111..2222222 100644",
      "GIT binary patch",
      "literal 1",
      "Ic$@<O000310RR91",
      "",
      "literal 1",
      "Ic$@<N000310RR91",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "assets/logo.png",
          newPath: "assets/logo.png",
          status: "binary",
          lines: [],
        },
      ],
    },
  });
});

test("classifies a mode-only change as metadata-only", () => {
  const result = parseUnifiedDiff(
    ["diff --git a/scripts/run.sh b/scripts/run.sh", "old mode 100644", "new mode 100755", ""].join(
      "\n",
    ),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "scripts/run.sh",
          newPath: "scripts/run.sh",
          status: "metadata-only",
          lines: [],
        },
      ],
    },
  });
});

test("rejects a bare Git file header without content or metadata", () => {
  const result = parseUnifiedDiff("diff --git a/src/config.ts b/src/config.ts\n");

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Malformed unified diff: a changed file has no content or recognized metadata.",
    },
  });
});

test("keeps coordinates stable across multiple CRLF hunks and no-newline markers", () => {
  const result = parseUnifiedDiff(
    [
      "--- a/src/config.ts\r",
      "+++ b/src/config.ts\r",
      "@@ -1 +1 @@\r",
      "-oldOne();\r",
      "+newOne();\r",
      "@@ -10 +12 @@\r",
      "-oldTwo();\r",
      "\\ No newline at end of file\r",
      "+newTwo();\r",
      "\\ No newline at end of file\r",
      "",
    ].join("\n"),
  );

  assert.deepEqual(result, {
    ok: true,
    diff: {
      files: [
        {
          oldPath: "src/config.ts",
          newPath: "src/config.ts",
          status: "modified",
          lines: [
            {
              location: { side: "old", path: "src/config.ts", line: 1 },
              content: "oldOne();",
              changed: true,
            },
            {
              location: { side: "new", path: "src/config.ts", line: 1 },
              content: "newOne();",
              changed: true,
            },
            {
              location: { side: "old", path: "src/config.ts", line: 10 },
              content: "oldTwo();",
              changed: true,
            },
            {
              location: { side: "new", path: "src/config.ts", line: 12 },
              content: "newTwo();",
              changed: true,
            },
          ],
        },
      ],
    },
  });
});

test("rejects a diff that exceeds the changed-file limit", () => {
  const result = parseUnifiedDiff(
    Array.from({ length: 101 }, (_, index) =>
      [
        `diff --git a/file-${String(index)}.ts b/file-${String(index)}.ts`,
        "old mode 100644",
        "new mode 100755",
        "",
      ].join("\n"),
    ).join(""),
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalid-diff",
      message: "Diff exceeds the 100-changed-file limit.",
    },
  });
});
