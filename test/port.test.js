import { test } from "node:test";
import assert from "node:assert/strict";
import { makePortPublic, portStatus } from "../server/port.js";

function fakeRun(results) {
  const calls = [];
  const run = async (args, opts) => {
    calls.push({ args, opts });
    return results[Math.min(calls.length - 1, results.length - 1)];
  };
  run.calls = calls;
  return run;
}

test("makes the port Public, retrying until it works, using the ports key", async () => {
  const lines = [];
  const run = fakeRun([{ ok: false, output: "port not forwarded yet" }, { ok: false, output: "x" }, { ok: true }]);
  const ok = await makePortPublic({ codespaceName: "cs-1", port: 3000, token: "ghp_x" }, { run, log: (l) => lines.push(l), delayMs: 0 });
  assert.equal(ok, true);
  assert.deepEqual(run.calls[0].args, ["codespace", "ports", "visibility", "3000:public", "-c", "cs-1"]);
  assert.equal(run.calls[0].opts.token, "ghp_x");
  assert.match(lines.join("\n"), /Attempt 1 failed.*port not forwarded yet/);
  assert.match(lines.at(-1), /Port 3000 is Public \(attempt 3\)/);
  assert.match(portStatus.message, /is Public/);
});

test("explains the problem when it can't make the port Public", async () => {
  const lines = [];
  const run = fakeRun([{ ok: false, output: "the GitHub CLI (gh) isn't installed; rebuild the Codespace (see README)" }]);
  const ok = await makePortPublic({ codespaceName: "cs-1" }, { run, log: (l) => lines.push(l), attempts: 3, delayMs: 0 });
  assert.equal(ok, false);
  assert.equal(run.calls.length, 3);
  assert.match(lines.join("\n"), /Couldn't make port 3000 Public automatically: the GitHub CLI \(gh\) isn't installed/);
  assert.match(lines.at(-1), /GH_PORTS_TOKEN/);
});

test("does nothing outside a Codespace", async () => {
  const run = fakeRun([{ ok: true }]);
  assert.equal(await makePortPublic({ codespaceName: "" }, { run, delayMs: 0 }), false);
  assert.equal(run.calls.length, 0);
});
