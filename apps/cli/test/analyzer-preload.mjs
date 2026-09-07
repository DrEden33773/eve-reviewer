// Replace only the external analyzer process. The CLI and Eve executor remain real.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";

const spawn = childProcess.spawn;
childProcess.spawn = (command, args, options) => {
  if (basename(command) !== "biome") return spawn(command, args, options);
  const child = spawn(
    process.execPath,
    ["-e", 'process.on("message", () => {}); process.send("ready");'],
    { ...options, stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  child.once("message", (message) => {
    if (message !== "ready") return;
    process.send?.(
      { kind: "analyzer-ready", pid: child.pid, directory: dirname(options.cwd) },
      () => {},
    );
  });
  child.once("close", (code, signal) => {
    process.send?.({ kind: "analyzer-closed", code, signal }, () => {});
  });
  return child;
};
syncBuiltinESMExports();
