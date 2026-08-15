import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { evaluationV1 } from "../src/index.ts";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const commandPath = fileURLToPath(new URL("../src/main.ts", import.meta.url));

test("root evaluation command prints one canonical passing replay result", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(packageJson.scripts["evaluation:compare"], "node packages/evaluation/src/main.ts");
  const result = spawnSync(process.execPath, [commandPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const decoded = evaluationV1.decodeResult(JSON.parse(result.stdout));
  assert.equal(decoded.ok, true);
  if (!decoded.ok || !decoded.value.payload.ok) {
    return;
  }
  assert.equal(decoded.value.payload.gate, "pass");
  assert.deepEqual(
    decoded.value.payload.cases.map(({ caseId }) => caseId),
    [
      "deleted-old-side",
      "dynamic-eval-new-side",
      "invalid-diff",
      "partial-mixed-coverage",
      "unsupported-no-coverage",
    ],
  );
  const encoded = evaluationV1.encodeResult(decoded.value);
  assert.equal(encoded.ok, true);
  assert.ok("value" in encoded);
  assert.equal(result.stdout, `${encoded.value}\n`);
});

test("root evaluation command rejects baseline promotion arguments", () => {
  const result = spawnSync(process.execPath, [commandPath, "--accept"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Usage: pnpm evaluation:compare\n");
});
