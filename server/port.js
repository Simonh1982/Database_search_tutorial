// Makes the tutor's Codespace port Public, so the GitHub Pages site can reach it.
// Codespaces resets forwarded ports to Private every time the Codespace restarts (for example after
// the "Wake the tutor" button starts it). Changing that needs the GitHub CLI and a key with the
// "codespace" scope, stored as the GH_PORTS_TOKEN Codespaces secret (see README, "Wake-up button").
// The tutor server runs this itself as soon as it starts.

import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Kept in the project's .tutor/ folder, which survives Codespace restarts.
export const STATUS_FILE = fileURLToPath(new URL("../.tutor/port.log", import.meta.url));

// The latest port message, shown by /api/health (check it in the Codespace with
// `curl -s localhost:3000/api/health`).
export const portStatus = { message: "" };

// Runs one `gh` command. Resolves { ok, output } and never throws.
export function runGh(args, { token = "", timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(token ? { GH_TOKEN: token } : {}) };
    execFile("gh", args, { env, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, output: String(stdout).trim() });
      if (err.code === "ENOENT") return resolve({ ok: false, output: "the GitHub CLI (gh) isn't installed; rebuild the Codespace (see README)" });
      if (err.killed) return resolve({ ok: false, output: `the command didn't finish within ${timeoutMs / 1000} seconds` });
      resolve({ ok: false, output: String(stderr || stdout || err.message).trim() });
    });
  });
}

function record(message, log) {
  const line = `[port] ${message}`;
  portStatus.message = message;
  log(line);
  try {
    mkdirSync(dirname(STATUS_FILE), { recursive: true });
    appendFileSync(STATUS_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // The status file is only a convenience for checking what happened.
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Tries for a few minutes while the Codespace finishes starting. Resolves true on success.
export async function makePortPublic(
  { codespaceName, port = 3000, token = "" },
  { run = runGh, log = console.log, attempts = 18, delayMs = 10_000 } = {},
) {
  if (!codespaceName) return false;
  record(`Making port ${port} Public so the web page can reach the tutor…`, log);
  let last = "";
  for (let i = 1; i <= attempts; i += 1) {
    await sleep(delayMs);
    const result = await run(["codespace", "ports", "visibility", `${port}:public`, "-c", codespaceName], { token });
    if (result.ok) {
      record(`Port ${port} is Public (attempt ${i}).`, log);
      return true;
    }
    last = result.output || "no details";
    if (i === 1) record(`Attempt 1 failed (will keep trying for a few minutes): ${last}`, log);
  }
  record(`Couldn't make port ${port} Public automatically: ${last}`, log);
  record("To fix: check the GH_PORTS_TOKEN Codespaces secret, or set it by hand: PORTS tab, right-click the port, Port Visibility, Public.", log);
  return false;
}
