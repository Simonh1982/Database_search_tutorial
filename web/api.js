// Talks to the tutor server in the Codespace, or falls back to the offline demo.

import { DEFAULT_BACKEND } from "./config.js";
import { demoFeedback } from "./shared/demo.js";
import { searchMesh, countPubMed } from "./shared/ncbi.js";

const STORAGE_KEY = "dst-connection";

export const connection = {
  base: "", // server origin, or "" when using the offline demo
  mode: "demo", // "live" | "no-ai" | "demo"
  provider: "",
  model: "",
  passcode: "",
  passcodeRequired: false,
  message: "",
};

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function save(values) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // Storage can be unavailable (private browsing); the app still works for this visit.
  }
}

function clean(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  let body = {};
  try {
    body = await res.json();
  } catch {
    // Not JSON (e.g. a Codespaces sign-in page); handled below.
  }
  if (!res.ok || typeof body !== "object") {
    const err = new Error(body?.error || `The server returned ${res.status}.`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function tryServer(base) {
  const health = await fetchJson(`${base}/api/health`, {}, 6000);
  if (!health?.ok) throw new Error("Unexpected response.");
  return health;
}

function applyHealth(base, health) {
  connection.base = base;
  connection.passcodeRequired = Boolean(health.passcodeRequired);
  connection.provider = health.ai?.provider || "";
  connection.model = health.ai?.model || "";
  connection.mode = health.ai?.ready ? "live" : "no-ai";
  connection.message = health.ai?.ready ? "" : (health.ai?.errors || []).map((e) => `${e.provider}: ${e.message}`).join(" ");
}

function useDemo(message = "") {
  Object.assign(connection, { base: "", mode: "demo", provider: "", model: "", passcodeRequired: false, message });
}

// Work out which server to use: ?backend= link, then saved setting, then config.js, then this site itself.
export async function autoConnect() {
  const saved = load();
  connection.passcode = saved.passcode || "";
  const params = new URLSearchParams(location.search);
  const fromLink = clean(params.get("backend"));
  if (fromLink) save({ ...saved, backend: fromLink });

  const candidates = [fromLink, clean(saved.backend), clean(DEFAULT_BACKEND)];
  if (!location.hostname.endsWith("github.io") && location.protocol.startsWith("http")) candidates.push(location.origin);

  for (const base of [...new Set(candidates.filter(Boolean))]) {
    try {
      applyHealth(base, await tryServer(base));
      return connection;
    } catch {
      // Try the next candidate.
    }
  }
  useDemo(candidates.some(Boolean) ? "The tutor server couldn't be reached, so the offline demo is being used." : "");
  return connection;
}

// Connect to a specific server from the Connection dialog ("" switches to the offline demo).
export async function connectTo(base, passcode = "") {
  const url = clean(base);
  connection.passcode = passcode;
  save({ backend: url, passcode });
  if (!url) {
    useDemo();
    return connection;
  }
  try {
    applyHealth(url, await tryServer(url));
  } catch (err) {
    useDemo(`Couldn't reach ${url}: ${err.message} Is the Codespace running and port 3000 set to Public?`);
  }
  return connection;
}

// Returns { feedback, source: "live" | "demo", notice? }
export async function requestFeedback(stage, data, attempt) {
  if (connection.mode === "no-ai") {
    return {
      feedback: demoFeedback(stage, data),
      source: "demo",
      notice: "The tutor server is running, but its AI isn't set up yet (see the README), so this is example feedback.",
    };
  }
  if (connection.mode !== "live") {
    return { feedback: demoFeedback(stage, data), source: "demo" };
  }
  try {
    const body = await fetchJson(
      `${connection.base}/api/feedback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(connection.passcode ? { "X-Demo-Passcode": connection.passcode } : {}) },
        body: JSON.stringify({ stage, attempt, data }),
      },
      120_000,
    );
    return { feedback: body.feedback, source: "live", provider: body.provider, model: body.model };
  } catch (err) {
    if (err.status === 401 || err.status === 429) throw err;
    return {
      feedback: demoFeedback(stage, data),
      source: "demo",
      notice: `The live tutor didn't respond (${err.message}), so this is example feedback instead.`,
    };
  }
}

// MeSH and PubMed look-ups go through the server when connected, or straight to NCBI otherwise.
export async function lookupMesh(term) {
  if (connection.base) {
    try {
      const body = await fetchJson(`${connection.base}/api/mesh?term=${encodeURIComponent(term)}`, {}, 20_000);
      return body.results;
    } catch (err) {
      if (err.status) throw err;
    }
  }
  return searchMesh(term);
}

export async function pubmedCount(query) {
  if (connection.base) {
    try {
      return await fetchJson(
        `${connection.base}/api/pubmed/count`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
        20_000,
      );
    } catch (err) {
      if (err.status) throw err;
    }
  }
  return countPubMed(query);
}
