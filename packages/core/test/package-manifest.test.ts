// biome-ignore-all lint/complexity/useLiteralKeys: Package manifest fixtures are decoded as unknown records.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the core bootstrap artifact is public and provenance-disabled", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;

  assert.deepEqual(
    {
      name: manifest["name"],
      version: manifest["version"],
      exports: manifest["exports"],
      files: manifest["files"],
      dependencies: manifest["dependencies"],
      publishConfig: manifest["publishConfig"],
    },
    {
      name: "@eve-reviewer/core",
      version: "0.0.0-bootstrap.0",
      exports: {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      },
      files: ["dist", "LICENSE", "README.md"],
      dependencies: { diff: "9.0.0", typebox: "1.3.6" },
      publishConfig: { access: "public", provenance: false },
    },
  );
});
