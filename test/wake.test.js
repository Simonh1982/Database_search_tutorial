import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../wake/worker.js";

const ORIGIN = "https://simonh1982.github.io";
const env = { GITHUB_TOKEN: "t", CODESPACE_NAME: "upgraded-memory-abc", ALLOWED_ORIGIN: ORIGIN };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Stand-in for the GitHub API: records calls and reports the given Codespace state.
function fakeGitHub(state, { status = 200, headers = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", ua: init.headers?.["User-Agent"] });
    const body = url.endsWith("/start") ? { state: "Starting" } : { state, message: "Forbidden" };
    return new Response(JSON.stringify(body), { status, headers });
  };
  return calls;
}

const call = (path, { method = "GET", origin = ORIGIN, headers = {} } = {}, e = env) =>
  worker.fetch(new Request(`https://tutor-wake.example.workers.dev${path}`, { method, headers: { Origin: origin, ...headers } }), e);

test("status reports the Codespace state, with CORS for the tutor's web page", async () => {
  const calls = fakeGitHub("Shutdown");
  const res = await call("/status");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { state: "Shutdown" });
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(calls[0].url, "https://api.github.com/user/codespaces/upgraded-memory-abc");
  assert.ok(calls[0].ua, "GitHub requires a User-Agent header");
});

test("wake starts a sleeping Codespace", async () => {
  const calls = fakeGitHub("Shutdown");
  const res = await call("/wake", { method: "POST" });
  assert.deepEqual(await res.json(), { state: "Starting", started: true });
  assert.equal(calls[1].url, "https://api.github.com/user/codespaces/upgraded-memory-abc/start");
  assert.equal(calls[1].method, "POST");
});

test("wake does nothing when the Codespace is already awake or starting", async () => {
  for (const state of ["Available", "Starting"]) {
    const calls = fakeGitHub(state);
    const res = await call("/wake", { method: "POST" });
    assert.deepEqual(await res.json(), { state, started: false });
    assert.equal(calls.length, 1);
  }
});

test("other websites can't ring the doorbell", async () => {
  fakeGitHub("Shutdown");
  const res = await call("/wake", { method: "POST", origin: "https://evil.example" });
  assert.equal(res.status, 403);
});

test("the preflight request is answered", async () => {
  const res = await call("/wake", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-headers"), /X-Wake-Passcode/);
});

test("a passcode is required when one is set", async () => {
  fakeGitHub("Shutdown");
  const withPasscode = { ...env, WAKE_PASSCODE: "librarian" };
  const denied = await call("/wake", { method: "POST" }, withPasscode);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, "passcode");
  const allowed = await call("/wake", { method: "POST", headers: { "X-Wake-Passcode": "librarian" } }, withPasscode);
  assert.equal(allowed.status, 200);
});

test("setup problems are explained, including missing token permissions", async () => {
  const missing = await call("/status", {}, { ALLOWED_ORIGIN: ORIGIN });
  assert.equal(missing.status, 500);
  assert.match((await missing.json()).error, /GITHUB_TOKEN and CODESPACE_NAME/);

  fakeGitHub("", { status: 403, headers: { "x-accepted-github-permissions": "codespaces_lifecycle_admin=write" } });
  const res = await call("/wake", { method: "POST" });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /codespaces_lifecycle_admin=write/);
});
