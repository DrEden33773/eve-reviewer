import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoots = ["packages/core", "packages/adam-extension"];
const offlineTarballs = parseOfflineTarballs(process.argv.slice(2));
const temporaryRoot = mkdtempSync(join(tmpdir(), "eve-reviewer-package-check-"));
const packRoot = join(temporaryRoot, "pack");
const installRoot = join(temporaryRoot, "install");
mkdirSync(packRoot);
mkdirSync(installRoot);

try {
  const tarballs = packageRoots.map((packageRoot) => pack(packageRoot));
  const [coreTarball, extensionTarball] = tarballs;
  assert.ok(coreTarball);
  assert.ok(extensionTarball);
  checkArchive(coreTarball, "@eve-reviewer/core");
  checkArchive(extensionTarball, "@eve-reviewer/adam-extension");
  checkPackedManifests(coreTarball, extensionTarball);
  freshInstall(coreTarball, extensionTarball);
  process.stdout.write(
    `${JSON.stringify({ mode: offlineTarballs.length === 0 ? "registry" : "offline", packages: tarballs.map((tarball) => tarball.filename) })}\n`,
  );
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function parseOfflineTarballs(arguments_) {
  const tarballs = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] !== "--offline-tarball") {
      throw new TypeError(`Unknown package-check argument: ${arguments_[index]}`);
    }
    const candidate = arguments_[index + 1];
    if (candidate === undefined) {
      throw new TypeError("--offline-tarball requires a path.");
    }
    const path = resolve(candidate);
    if (!existsSync(path)) {
      throw new TypeError(`Offline tarball is unavailable: ${path}`);
    }
    tarballs.push(path);
    index += 1;
  }
  return tarballs;
}

function command(executable, arguments_, options = {}) {
  return execFileSync(executable, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function pack(packageRoot) {
  const existingFiles = new Set(readdirSync(packRoot));
  command(
    "pnpm",
    ["--config.verify-deps-before-run=warn", "pack", "--pack-destination", packRoot],
    { cwd: join(repositoryRoot, packageRoot) },
  );
  const filename = readdirSync(packRoot).find((candidate) => !existingFiles.has(candidate));
  assert.ok(filename);
  const path = join(packRoot, filename);
  assert.equal(existsSync(path), true);
  return { filename, path };
}

function archiveFiles(tarball) {
  return command("tar", ["-tf", tarball.path]).trim().split("\n").filter(Boolean).toSorted();
}

function packedManifest(tarball) {
  return JSON.parse(command("tar", ["-xOf", tarball.path, "package/package.json"]));
}

function checkArchive(tarball, packageName) {
  const files = archiveFiles(tarball);
  assert.equal(files.includes("package/LICENSE"), true);
  assert.equal(files.includes("package/README.md"), true);
  assert.equal(files.includes("package/package.json"), true);
  assert.equal(
    files.some((path) => path.startsWith("package/dist/")),
    true,
  );
  assert.equal(
    files.every(
      (path) =>
        path === "package/LICENSE" ||
        path === "package/README.md" ||
        path === "package/package.json" ||
        path.startsWith("package/dist/"),
    ),
    true,
    `${packageName} contains a file outside dist/LICENSE/README/package.json`,
  );
}

function checkPackedManifests(coreTarball, extensionTarball) {
  const core = packedManifest(coreTarball);
  const extension = packedManifest(extensionTarball);
  assert.deepEqual(
    {
      exports: core.exports,
      name: core.name,
      publishConfig: core.publishConfig,
      version: core.version,
    },
    {
      exports: { ".": { default: "./dist/index.js", types: "./dist/index.d.ts" } },
      name: "@eve-reviewer/core",
      publishConfig: { access: "public", provenance: true },
      version: "0.1.0",
    },
  );
  assert.deepEqual(
    {
      dependencies: extension.dependencies,
      exports: extension.exports,
      name: extension.name,
      peerDependencies: extension.peerDependencies,
      publishConfig: extension.publishConfig,
      version: extension.version,
    },
    {
      dependencies: { "@eve-reviewer/core": "0.1.0" },
      exports: { ".": { default: "./dist/index.js", types: "./dist/index.d.ts" } },
      name: "@eve-reviewer/adam-extension",
      peerDependencies: { "@adam-agent/extension-api": "0.1.0" },
      publishConfig: { access: "public", provenance: true },
      version: "0.1.0",
    },
  );
}

function freshInstall(coreTarball, extensionTarball) {
  writeFileSync(
    join(installRoot, "package.json"),
    `${JSON.stringify({ name: "eve-reviewer-package-check", private: true, type: "module" })}\n`,
    { encoding: "utf8", flag: "wx" },
  );
  const dependencies =
    offlineTarballs.length === 0
      ? ["@adam-agent/extension-api@0.1.0"]
      : ["--offline", ...offlineTarballs];
  command(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...dependencies,
      coreTarball.path,
      extensionTarball.path,
    ],
    {
      cwd: installRoot,
      env: { ...process.env, npm_config_cache: join(temporaryRoot, "npm-cache") },
    },
  );
  const probe = command(
    "node",
    [
      "--input-type=module",
      "--eval",
      [
        'import * as core from "@eve-reviewer/core";',
        'import * as extension from "@eve-reviewer/adam-extension";',
        'if (typeof core.parseUnifiedDiff !== "function" || typeof core.createReviewUseCase !== "function") throw new Error("Invalid core root.");',
        'if (Object.keys(extension).length !== 1 || typeof extension.activate !== "function") throw new Error("Invalid extension root.");',
      ].join(""),
    ],
    { cwd: installRoot },
  );
  assert.equal(probe, "");
  const installedExtension = JSON.parse(
    readFileSync(
      join(installRoot, "node_modules/@eve-reviewer/adam-extension/package.json"),
      "utf8",
    ),
  );
  assert.deepEqual(installedExtension.dependencies, { "@eve-reviewer/core": "0.1.0" });
}
