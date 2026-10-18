import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.PREVIEW_MODE = "1";
await import("./build-publication-data.mjs");

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["eleventy", "--serve"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
