// Talks to the tutor server in the Codespace, or falls back to the offline demo.

import { DEFAULT_BACKEND, WAKE_URL } from "./config.js";
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
  asleep: "", // address of a tutor server that didn't answer and can be woken, or ""
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

function useDemo(message = "", sleepingBase = "") {
  Object.assign(connection, { base: "", mode: "demo", provider: "", model: "", passcodeRequired: false, message });
  // A tutor server that didn't answer is probably asleep; offer to wake it if a doorbell is set up.
  connection.asleep = WAKE_URL && sleepingBase && !sleepingBase.startsWith(location.origin) ? sleepingBase : "";
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
  const wanted = candidates.find(Boolean) || "";
  useDemo(wanted ? "The tutor server couldn't be reached, so the offline demo is being used." : "", wanted);
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
    useDemo(`Couldn't reach ${url}: ${err.message} Is the Codespace running and port 3000 set to Public?`, url);
  }
  return connection;
}

// ---------- Waking the tutor ----------

export const canWake = () => Boolean(WAKE_URL && connection.asleep);

export function setPasscode(passcode) {
  connection.passcode = passcode;
  save({ ...load(), passcode });
}

// Rings the doorbell, then waits for the tutor to answer. `onProgress(seconds, state)` is called
// while waiting. Resolves with the connection once the tutor is ready; throws if it doesn't wake.
export async function wakeTutor(onProgress = () => {}) {
  const doorbell = clean(WAKE_URL);
  const target = connection.asleep;
  const rung = await fetchJson(
    `${doorbell}/wake`,
    { method: "POST", headers: connection.passcode ? { "X-Wake-Passcode": connection.passcode } : {} },
    20_000,
  );

  const started = Date.now();
  let state = rung.state || "Starting";
  for (let check = 0; Date.now() - started < 5 * 60_000; check += 1) {
    onProgress(Math.round((Date.now() - started) / 1000), state);
    try {
      applyHealth(target, await tryServer(target));
      connection.asleep = "";
      connection.message = "";
      return connection;
    } catch {
      // Not ready yet.
    }
    if (check % 3 === 2) {
      try {
        state = (await fetchJson(`${doorbell}/status`, {}, 10_000)).state || state;
      } catch {
        // Keep the last known state.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`The tutor didn't wake up within 5 minutes (its Codespace says "${state}"). Please try again, or ask the person running it to check.`);
}

// Returns { feedback, source: "live" | "demo", notice? }
// `context` carries the student's earlier attempts so the tutor stays consistent:
//   history – previous attempts at this stage [{ attempt, work, feedback }]
//   earlier – latest feedback from earlier stages [{ stage, feedback }]
export async function requestFeedback(stage, data, attempt, context = {}) {
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
        body: JSON.stringify({ stage, attempt, data, history: context.history || [], earlier: context.earlier || [] }),
      },
      120_000,
    );
    return {
      feedback: body.feedback,
      source: "live",
      provider: body.provider,
      model: body.model,
      notice: body.repeated ? "You haven't changed anything since your last submission, so this is the same feedback as before." : "",
    };
  } catch (err) {
    if (err.status === 401 || err.status === 429) throw err;
    // No answer at all: the tutor has probably gone to sleep, so offer to wake it.
    if (!err.status) useDemo("The tutor stopped responding.", connection.base);
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
