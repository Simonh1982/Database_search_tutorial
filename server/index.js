// Tutor backend: serves the web app and a small JSON API.
//   GET  /api/health         – is the AI tutor ready?
//   POST /api/feedback       – AI feedback on a stage  { stage, attempt, data }
//   GET  /api/mesh?term=…    – MeSH heading lookup (NCBI E-utilities)
//   POST /api/pubmed/count   – PubMed result count    { query }
// Run with `npm start`. See README.md for configuration.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";

import { loadConfig, codespaceUrl } from "./config.js";
import { DailyCounter, WindowLimiter } from "./rateLimit.js";
import { startAI, getFeedback } from "./ai/index.js";
import { searchMesh, countPubMed } from "../web/shared/ncbi.js";

const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
const MAX_BODY_BYTES = 128 * 1024; // room for earlier attempts sent as context

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "That request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new HttpError(400, "The request wasn't valid JSON.");
  }
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function sameText(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(config, { ai = { provider: null, errors: [] }, fetchImpl = fetch, log = console.log } = {}) {
  const selfOrigin = codespaceUrl(config);
  const aiPerIp = new WindowLimiter({ limit: config.aiPerIpLimit, windowMs: config.aiPerIpWindowMinutes * 60_000 });
  const aiDaily = new DailyCounter({ limit: config.aiDailyLimit });
  const lookups = new WindowLimiter({ limit: config.lookupPerIpPerMinute, windowMs: 60_000 });

  function originAllowed(req, origin) {
    if (!origin) return true;
    if (config.allowedOrigins.includes(origin) || origin === selfOrigin) return true;
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  function corsHeaders(origin) {
    if (!origin) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Demo-Passcode",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
  }

  function checkLookupLimit(req) {
    const r = lookups.take(clientIp(req));
    if (!r.ok) throw new HttpError(429, "Too many look-ups. Please wait a minute and try again.", { retryAfterSeconds: r.retryAfterSeconds });
  }

  const routes = {
    "GET /api/health": async () => ({
      ok: true,
      ai: {
        ready: Boolean(ai.provider),
        provider: ai.provider?.name || "",
        model: ai.provider?.model || "",
        errors: ai.provider ? [] : ai.errors,
      },
      passcodeRequired: Boolean(config.passcode),
      aiRequestsLeftToday: aiDaily.remaining(),
    }),

    "POST /api/feedback": async (req) => {
      const body = await readJson(req);
      if (config.passcode && !sameText(req.headers["x-demo-passcode"] || "", config.passcode)) {
        throw new HttpError(401, "This tutor needs a passcode. Enter it under Connection.", { code: "passcode" });
      }
      if (!ai.provider) {
        throw new HttpError(503, "The AI tutor isn't running on this server.", { errors: ai.errors });
      }
      const stage = Number(body.stage);
      if (![1, 2, 3, 4, 5].includes(stage)) throw new HttpError(400, "Unknown stage.");

      const ip = clientIp(req);
      const r = aiPerIp.take(ip);
      if (!r.ok) {
        throw new HttpError(429, "You've asked for a lot of feedback in a short time. Please take a break and try again later.", {
          retryAfterSeconds: r.retryAfterSeconds,
        });
      }
      if (!aiDaily.take()) throw new HttpError(429, "The tutor has reached today's limit for this demo. Please try again tomorrow.");

      const started = Date.now();
      try {
        const { feedback, repeated } = await getFeedback(ai.provider, {
          stage,
          data: body.data || {},
          attempt: body.attempt,
          history: body.history,
          earlier: body.earlier,
        });
        log(`${new Date().toISOString()} feedback stage=${stage} attempt=${body.attempt ?? 1}${repeated ? " (unchanged, not sent to AI)" : ""} ${Date.now() - started}ms`);
        return { feedback, repeated, provider: ai.provider.name, model: ai.provider.model };
      } catch (err) {
        log(`${new Date().toISOString()} feedback stage=${stage} failed: ${err.message}`);
        throw new HttpError(502, `The AI tutor couldn't respond: ${err.message}`);
      }
    },

    "GET /api/mesh": async (req, url) => {
      checkLookupLimit(req);
      const term = (url.searchParams.get("term") || "").trim().slice(0, 100);
      if (!term) throw new HttpError(400, "Enter a word or phrase to look up.");
      try {
        return { results: await searchMesh(term, { fetchImpl, apiKey: config.ncbiApiKey }) };
      } catch (err) {
        throw new HttpError(502, `The MeSH look-up failed: ${err.message}`);
      }
    },

    "POST /api/pubmed/count": async (req) => {
      checkLookupLimit(req);
      const { query } = await readJson(req);
      const q = String(query || "").trim();
      if (!q) throw new HttpError(400, "The search is empty.");
      if (q.length > 4000) throw new HttpError(400, "That search is too long.");
      try {
        return await countPubMed(q, { fetchImpl, apiKey: config.ncbiApiKey });
      } catch (err) {
        throw new HttpError(502, `The PubMed search failed: ${err.message}`);
      }
    },
  };

  async function serveStatic(url, res) {
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(404, "Not found.");
    }
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(WEB_DIR, path));
    if (!file.startsWith(WEB_DIR.endsWith(sep) ? WEB_DIR : WEB_DIR + sep)) throw new HttpError(404, "Not found.");
    let body;
    try {
      body = await readFile(file);
    } catch {
      throw new HttpError(404, "Not found.");
    }
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(file)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(body);
  }

  return async function handle(req, res) {
    const url = new URL(req.url, "http://localhost");
    const origin = req.headers.origin;
    const isApi = url.pathname.startsWith("/api/");

    try {
      if (isApi) {
        if (!originAllowed(req, origin)) throw new HttpError(403, "This website isn't allowed to use the tutor.");
        if (req.method === "OPTIONS") {
          res.writeHead(204, corsHeaders(origin));
          return res.end();
        }
        const route = routes[`${req.method} ${url.pathname}`];
        if (!route) throw new HttpError(404, "Not found.");
        return sendJson(res, 200, await route(req, url), corsHeaders(origin));
      }
      if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.");
      return await serveStatic(url, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) log(`Unexpected error: ${err.stack || err}`);
      const headers = isApi && originAllowed(req, origin) ? corsHeaders(origin) : {};
      if (err.extra?.retryAfterSeconds) headers["Retry-After"] = String(err.extra.retryAfterSeconds);
      return sendJson(res, status, { error: status === 500 ? "Something went wrong on the server." : err.message, ...(err.extra || {}) }, headers);
    }
  };
}

async function main() {
  const config = loadConfig();
  console.log("Database Search Tutorial server");
  console.log(`Starting AI provider (trying: ${config.providers.join(", ")})…`);
  const ai = await startAI(config);
  if (ai.provider) {
    const who = ai.provider.account ? ` as ${ai.provider.account}` : "";
    console.log(`  ✓ Using ${ai.provider.name} (${ai.provider.model})${who}`);
    if (["auto", "Copilot default"].includes(ai.provider.model)) {
      console.log("    Note: Copilot may switch models between requests, so feedback can vary.");
      console.log("    For more consistent feedback, set COPILOT_MODEL to a fixed model (see README).");
    }
  } else {
    console.log("  ! The AI tutor isn't running. The app still works, but gives example feedback");
    console.log("    instead of AI feedback until Copilot is set up (see README).");
  }

  const server = http.createServer(createApp(config, { ai }));
  server.listen(config.port, "0.0.0.0", () => {
    const publicUrl = codespaceUrl(config);
    console.log(`\nApp running at http://localhost:${config.port}`);
    if (publicUrl) {
      console.log(`Codespace address: ${publicUrl}`);
      console.log("\nTo share with colleagues, make port " + config.port + " Public (run `npm run share`), then send them:");
      console.log(`  ${config.pagesUrl}?backend=${encodeURIComponent(publicUrl)}`);
    }
    if (config.passcode) console.log("A passcode is required for AI feedback (DEMO_PASSCODE).");
  });

  const shutdown = async () => {
    server.close();
    await ai.provider?.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
