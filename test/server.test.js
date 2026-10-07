import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createApp } from "../server/index.js";
import { loadConfig } from "../server/config.js";
import { createMockProvider } from "../server/ai/mock.js";

const PAGES_ORIGIN = "https://simonh1982.github.io";
let server;
let base;

function startServer(env = {}, options = {}) {
  const config = loadConfig({ AI_PROVIDER: "mock", ...env });
  const ai = options.ai ?? { provider: createMockProvider(), errors: [] };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ esearchresult: { count: "42", querytranslation: "x" } }) });
  const s = http.createServer(createApp(config, { ai, fetchImpl, log: () => {} }));
  return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(s)));
}

before(async () => {
  server = await startServer({ AI_PER_IP_LIMIT: "3" });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("health reports the provider", async () => {
  const res = await fetch(`${base}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ai.ready, true);
  assert.equal(body.ai.provider, "mock");
});

test("feedback returns normalised feedback", async () => {
  const res = await post("/api/feedback", { stage: 2, attempt: 1, data: { question: "Q", concepts: ["asthma"] } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.feedback.items[0].label, "asthma");
  assert.equal(body.feedback.modelAnswer, "");
});

test("feedback rejects unknown stages", async () => {
  const res = await post("/api/feedback", { stage: 7 });
  assert.equal(res.status, 400);
});

test("the GitHub Pages site may call the API; other sites may not", async () => {
  const ok = await fetch(`${base}/api/health`, { headers: { Origin: PAGES_ORIGIN } });
  assert.equal(ok.headers.get("access-control-allow-origin"), PAGES_ORIGIN);

  const preflight = await fetch(`${base}/api/feedback`, {
    method: "OPTIONS",
    headers: { Origin: PAGES_ORIGIN, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /X-Demo-Passcode/);

  const blocked = await fetch(`${base}/api/health`, { headers: { Origin: "https://evil.example" } });
  assert.equal(blocked.status, 403);
});

test("per-visitor rate limit applies to AI feedback", async () => {
  const s = await startServer({ AI_PER_IP_LIMIT: "2" });
  const url = `http://127.0.0.1:${s.address().port}/api/feedback`;
  const send = () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage: 1, data: { question: "Q" } }) });
  assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 200);
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  s.close();
});

test("passcode is required when configured", async () => {
  const s = await startServer({ DEMO_PASSCODE: "librarian" });
  const url = `http://127.0.0.1:${s.address().port}/api/feedback`;
  const body = JSON.stringify({ stage: 1, data: { question: "Q" } });
  const denied = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, "passcode");
  const allowed = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Demo-Passcode": "librarian" }, body });
  assert.equal(allowed.status, 200);
  s.close();
});

test("feedback explains when no AI provider is running", async () => {
  const s = await startServer({}, { ai: { provider: null, errors: [{ provider: "copilot", message: "not signed in" }] } });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage: 1, data: {} }),
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).errors[0].message, "not signed in");
  s.close();
});

test("PubMed count is proxied", async () => {
  const res = await post("/api/pubmed/count", { query: "asthma" });
  assert.equal((await res.json()).count, 42);
});

test("serves the web app but not files outside it", async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Database Search Tutorial/);
  const escape = await fetch(`${base}/..%2fpackage.json`);
  assert.equal(escape.status, 404);
});
