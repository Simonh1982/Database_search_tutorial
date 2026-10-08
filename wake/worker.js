// "Doorbell" for the Database Search Tutorial: wakes the tutor's Codespace when it's asleep.
// It runs on Cloudflare Workers (free plan) so it's always available, and it keeps the GitHub
// token private: the token never reaches the browser. See README, "Wake-up button".
//
// Settings (Cloudflare → your Worker → Settings → Variables and Secrets):
//   GITHUB_TOKEN    secret  Fine-grained token for this repository with "Codespaces" (read) and
//                           "Codespaces lifecycle admin" (read and write) permissions
//   CODESPACE_NAME  text    Your Codespace's name, e.g. upgraded-memory-w59vv797wjvc5vgr
//   ALLOWED_ORIGIN  text    The web page allowed to ring the doorbell: https://simonh1982.github.io
//   WAKE_PASSCODE   secret  Optional. If set, colleagues must enter it to wake the tutor
//
// Endpoints:
//   GET  /status  → { state }            e.g. "Available" (awake) or "Shutdown" (asleep)
//   POST /wake    → { state, started }   starts the Codespace if it's asleep

const AWAKE = new Set(["Available"]);
const ON_THE_WAY = new Set(["Starting", "Queued", "Provisioning", "Awaiting", "Created", "Rebuilding", "Updating"]);

function corsHeaders(origin) {
  return origin
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Wake-Passcode",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      }
    : {};
}

function reply(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(origin) },
  });
}

async function github(env, path, method = "GET") {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "database-search-tutorial-wake",
    },
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    // Some responses have no body.
  }
  if (!res.ok) {
    // GitHub names the permission a token is missing in this header, which makes setup errors easy to fix.
    const needed = res.headers.get("x-accepted-github-permissions");
    throw new Error(`GitHub said ${res.status} (${body.message || "error"})${needed ? `. The token needs these permissions: ${needed}` : ""}`);
  }
  return body;
}

function sameText(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowedOrigins = String(env.ALLOWED_ORIGIN || "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);

    if (origin && !allowedOrigins.includes(origin)) return reply({ error: "This website isn't allowed to wake the tutor." }, 403, "");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    if (!env.GITHUB_TOKEN || !env.CODESPACE_NAME) {
      return reply({ error: "The wake-up service isn't set up yet: add GITHUB_TOKEN and CODESPACE_NAME in the Worker's settings." }, 500, origin);
    }
    const codespace = `/user/codespaces/${encodeURIComponent(String(env.CODESPACE_NAME).trim())}`;

    try {
      if (request.method === "GET" && (url.pathname === "/status" || url.pathname === "/")) {
        const cs = await github(env, codespace);
        return reply({ state: cs.state }, 200, origin);
      }

      if (request.method === "POST" && url.pathname === "/wake") {
        if (env.WAKE_PASSCODE && !sameText(request.headers.get("X-Wake-Passcode") || "", env.WAKE_PASSCODE)) {
          return reply({ error: "Please enter the passcode to wake the tutor.", code: "passcode" }, 401, origin);
        }
        const cs = await github(env, codespace);
        if (AWAKE.has(cs.state) || ON_THE_WAY.has(cs.state)) return reply({ state: cs.state, started: false }, 200, origin);
        const started = await github(env, `${codespace}/start`, "POST");
        return reply({ state: started.state || "Starting", started: true }, 200, origin);
      }

      return reply({ error: "Not found." }, 404, origin);
    } catch (err) {
      return reply({ error: err.message }, 502, origin);
    }
  },
};
