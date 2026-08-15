import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readBoundedTextFile } from "../src/bounded-file.ts";

test("aborts an open bounded file stream and waits for descriptor cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eve-bounded-file-"));
  const path = join(directory, "input.txt");
  const controller = new AbortController();
  try {
    await writeFile(path, "a".repeat(1_000_000), "utf8");

    const result = await readBoundedTextFile(
      path,
      2_000_000,
      {
        signal: controller.signal,
        deadline: Date.now() + 5_000,
        graceMilliseconds: 250,
      },
      {
        afterChunkRead() {
          controller.abort();
        },
      },
    );

    assert.deepEqual(result, { ok: false, failure: "cancelled" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
