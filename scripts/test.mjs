import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values, positionals } = parseArgs({
  options: { name: { type: "string", short: "t" } },
  allowPositionals: true,
});
const files =
  positionals.length > 0
    ? positionals
    : globSync(
        [
          "packages/core/test/*.test.ts",
          "packages/adam-extension/test/*.test.ts",
          "packages/evaluation/test/*.test.ts",
          "apps/cli/test/*.test.ts",
        ],
        { cwd: root },
      ).sort();
const result = spawnSync(
  process.execPath,
  [
    "--test",
    ...(values.name === undefined ? [] : [`--test-name-pattern=${values.name}`]),
    ...files,
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error !== undefined) throw result.error;
process.exitCode = result.status ?? 1;
