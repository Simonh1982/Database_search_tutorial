# Blueprint: a GitHub Pages web app with an AI backend in a Codespace, woken remotely

This document explains how the **Database Search Tutorial**
(`Simonh1982/Database_search_tutorial`) runs. It is written for a future Claude Code session
that needs to build a **new, different web app on the same architecture**, without repeating the
trial and error it took to get here.

Everything below has been tested end to end in the live system (October 2026), unless it is
marked as unverified. The reference code is in that repository; the file paths named here are
from it. Ask the user to attach that repository to the session (or use `add_repo`) to copy files.

---

## 1. What the system does

```
 Visitor's browser                         Cloudflare Worker ("doorbell")
┌───────────────────────────┐  /status   ┌────────────────────────────┐   GitHub REST API
│ GitHub Pages (static site)│ ─────────▶ │ holds a GitHub token that  │ ──────────────────▶
│ owner.github.io/repo/     │  /wake     │ can only see/start the     │  GET  /user/codespaces/{name}
│                           │ ─────────▶ │ Codespace                  │  POST /user/codespaces/{name}/start
│                           │            └────────────────────────────┘
│                           │   HTTPS (port 3000 must be Public)
│                           │ ──────────────────────────────────────────▶ ┌──────────────────────────────┐
│ No backend reachable?     │ ◀────────────────────────────────────────── │ Codespace (owner's account)  │
│ → offline demo, plus a    │      JSON API: /api/health, /api/…          │ Node server, started on boot │
│   "Wake" button           │                                             │  ├─ GitHub Copilot SDK → AI  │
└───────────────────────────┘                                             │  └─ makes its port Public    │
                                                                          └──────────────────────────────┘
```

- **Front end:** plain HTML, CSS and ES modules in `web/`, no build step. GitHub Actions
  publishes it to GitHub Pages. It always works, even with no backend, by falling back to an
  offline demo.
- **Backend:** a small Node.js server (no framework) in the owner's **GitHub Codespace**. It
  calls **GitHub Copilot** through the **Copilot SDK**, so AI use is billed to the owner's Copilot
  licence (Imperial's Copilot Business seat), not a separate API account.
- **Waking:** Codespaces stop when idle. A **Cloudflare Worker** (free plan) holds a narrowly
  scoped GitHub token. It reports the Codespace's state and starts it on request. The browser
  shows "Wake the tutor" and polls until the backend answers.
- **On start-up,** the server makes its own forwarded port **Public**, because Codespaces resets
  ports to Private on every restart.

**Why this design.** It was a proof of concept for colleagues, with near-zero cost and no new
accounts or credit cards beyond GitHub and a free Cloudflare account. It isn't production
hosting: the backend sleeps, and cold starts take 1–2 minutes.

---

## 2. Components and files (reference implementation)

| Piece | File(s) | Purpose |
|---|---|---|
| Codespace set-up | `.devcontainer/devcontainer.json` | Node image, installs `gh`, starts the server on boot |
| Start-up script | `scripts/start-tutor.sh` | Runs the server correctly at boot, on attach and on restart; persistent logs |
| Server | `server/index.js`, `server/config.js` | HTTP server, JSON API, CORS, passcode, rate limits, static files |
| Port fixer | `server/port.js` | Makes the port Public with `gh`, with retries; logs the result |
| AI provider | `server/ai/copilot.js`, `server/ai/index.js` | Copilot SDK client: start-up test, model choice, provider fallback |
| Reply parsing | `server/ai/parse.js` | Tolerant JSON extraction and normalisation of model output |
| Mock AI | `server/ai/mock.js` | For development and tests (`AI_PROVIDER=mock`) |
| Doorbell | `wake/worker.js` | Cloudflare Worker: `GET /status`, `POST /wake` |
| Front-end connection | `web/api.js`, `web/config.js` | Finds the backend, falls back to demo, wake-up polling |
| Front-end UI | `web/app.js` (`renderWakeBanner`, `startWake`) | Wake banner with progress |
| Pages publishing | `.github/workflows/pages.yml`, `scripts/stamp-versions.sh` | Deploys `web/`; adds `?v=<commit>` to file addresses |
| Helpers | `scripts/share-port.sh` (`npm run share`), `scripts/list-copilot-models.js` (`npm run models`) | Manual port sharing; list Copilot models and costs |
| Tests | `test/*.test.js` (`npm test`, Node's built-in test runner) | Includes Worker tests with a fake GitHub API |

---

## 3. AI through GitHub Copilot (Copilot SDK)

### Package and client set-up

- Package: **`@github/copilot-sdk`** (version 1.0.17 in use). Import it dynamically, so the
  server still starts if it is missing.
- Use it as a plain "send a prompt, get text back" service, with **no tools**:

```js
const { CopilotClient } = await import("@github/copilot-sdk");
const home = join(tmpdir(), "my-app-copilot");          // keep the SDK's files out of the repo
mkdirSync(home, { recursive: true });
const client = new CopilotClient({
  mode: "empty",                      // no built-in agent behaviour
  baseDirectory: home,
  workingDirectory: home,
  logLevel: "error",
  ...(token ? { gitHubToken: token } : { useLoggedInUser: true }),
});
await client.start();
const auth = await client.getAuthStatus();     // { isAuthenticated, login }
const models = await client.listModels().catch(() => []);

async function ask(model, system, prompt, timeoutMs) {
  const session = await client.createSession({
    ...(model ? { model } : {}),
    systemMessage: { mode: "replace", content: system },   // our prompt, not Copilot's
    availableTools: [],                                    // no tools at all
    infiniteSessions: { enabled: false },
    onPermissionRequest: () => ({ kind: "reject", feedback: "Tools are not available." }),
  });
  try {
    const reply = await session.sendAndWait({ prompt }, timeoutMs);
    return reply?.data?.content ?? "";
  } finally {
    await session.disconnect().catch(() => {});
  }
}
```

### Authentication: the token

- Create a **fine-grained personal access token** with the **Copilot Requests** permission. It
  needs **no repository access**.
- Store it as a **Codespaces secret** named `COPILOT_GITHUB_TOKEN`, scoped to the repository.
  The server passes it as `gitHubToken`.
- Don't rely on `useLoggedInUser` in a Codespace. The Codespace's built-in `GITHUB_TOKEN`
  isn't a Copilot credential, and fails with **403 "not authorized"**.
- The account that owns the token must have a Copilot seat. Imperial staff link their GitHub
  account to the Imperial organisation to get Copilot Business. Copilot Free works for testing,
  with a small allowance.

### Choosing a model

- Set the **`COPILOT_MODEL`** Codespaces secret to a model ID. **Run `npm run models`** to see
  the IDs and cost multipliers available to the account; don't guess IDs. The live system uses
  `claude-sonnet-5.5` on Copilot Business.
- **Copilot Free returns an empty model list.** The provider then tries fixed models in turn
  (`gpt-5-mini`, `gpt-4.1`), then `"auto"`, then no model at all. It keeps the first one that
  answers.
- Avoid `"auto"` when consistency matters: Copilot can switch models between requests.
- **Send one tiny test message at start-up** ("Reply with the single word OK"), so "ready"
  really means Copilot answers. Report a short error otherwise. Copilot errors embed long HTTP
  header dumps; extract the `"body"` text (`shortError` in `copilot.js`).

### Prompts and output

- Ask for a **single JSON object** with fixed keys. Parse it forgivingly: strip code fences and
  take the text from the first `{` to the last `}` (`parse.js`). Normalise every field, and
  show the raw text if parsing fails, rather than an error.
- Keep the teaching or behaviour rules in **Markdown "skill" files** (`skills/*/SKILL.md`),
  re-read on every request. Non-programmers can then change behaviour without restarting.
- Treat user input as data: wrap it in tags (e.g. `<student_work>`) and say so in the system
  prompt.

### Cost controls (the server is publicly reachable)

| Control | Default | Notes |
|---|---|---|
| `AI_DAILY_LIMIT` | 300 | Requests per day, all visitors combined |
| `AI_PER_IP_LIMIT` / `AI_PER_IP_WINDOW` | 40 per 60 min | Per visitor |
| `DEMO_PASSCODE` | none | Sent as the `X-Demo-Passcode` header; compared with `timingSafeEqual` |
| `ALLOWED_ORIGINS` | the Pages origin, localhost, the server's own origin | CORS allow-list |
| Body size limit | 128 KB | |
| Identical resubmission | not sent to AI | Returns the previous reply |

### Dead end to avoid

**GitHub Models** (`models.github.ai`) was retired on **30 July 2026**. It now answers with an
"OK…" body that isn't JSON. Don't use it.

---

## 4. The Codespace backend

### devcontainer.json

```json
{
  "image": "mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm",
  "features": { "ghcr.io/devcontainers/features/github-cli:1": {} },
  "postCreateCommand": "npm install",
  "postStartCommand": "bash scripts/start-tutor.sh --foreground",
  "postAttachCommand": "bash scripts/start-tutor.sh --watch",
  "forwardPorts": [3000],
  "portsAttributes": { "3000": { "label": "App", "onAutoForward": "notify" } },
  "secrets": {
    "COPILOT_GITHUB_TOKEN": { "description": "Fine-grained token with Copilot Requests permission" }
  }
}
```

- **The `javascript-node` image doesn't include `gh`.** Add the `github-cli` feature, or the
  port-fixing step fails with `ENOENT` / exit code 127.
- **After changing `devcontainer.json`,** rebuild once: Ctrl + Shift + P →
  **Codespaces: Rebuild Container**. Files and the Codespace name are kept.

### Starting the server reliably

This took the longest to get right.

- **A background process started from `postStartCommand` does not survive.** When the
  command finishes, the process is killed, even with `nohup` and `setsid`. Symptoms after a
  remote wake: no `node` process, nothing in the log, the health check fails from inside the
  Codespace.
- **Fix:** run the server **in the foreground** in `postStartCommand`. The step then never
  "finishes" while the server runs, and that worked.
- `postAttachCommand` (runs when someone opens the Codespace in VS Code) starts the server
  **only if it isn't already running**, then tails the log. Ctrl + C stops the tail, not the
  server.
- `npm run tutor` (no flag) restarts the server in the background (`setsid nohup … &`) and tails
  the log. Use it after `git pull`; it works from an interactive terminal.
- Match the process with `pgrep -f '^node server/index\.js'`. A loose pattern (e.g.
  `server/index.js`) matched other commands, including the one doing the killing.
- **Write logs inside the workspace** (`.tutor/`, git-ignored), not `/tmp`, so they survive
  restarts:
  - `start.log`: one line per start-up step, with the mode, user and Codespace name;
  - `tutor.log`: the server's output;
  - `port.log`: the port-visibility result.
- In the server, log stop signals and **ignore `SIGHUP`**: a closing terminal sends it.

Condensed `scripts/start-tutor.sh`:

```bash
cd "$(dirname "$0")/.." || exit 1
DIR="$PWD/.tutor"; mkdir -p "$DIR"; LOG="$DIR/tutor.log"; MODE="${1:-}"
note() { echo "$(date -u +%FT%TZ) [$MODE] $*" >>"$DIR/start.log"; }
running() { pgrep -f '^node server/index\.js' >/dev/null 2>&1; }
case "$MODE" in
  --foreground) pkill -f '^node server/index\.js'; : >"$LOG"; note "foreground"
                node server/index.js >>"$LOG" 2>&1 </dev/null; note "stopped ($?)"; exit 0 ;;
  --watch)      running || { setsid nohup node server/index.js >>"$LOG" 2>&1 </dev/null & } ;;
  *)            pkill -f '^node server/index\.js'; sleep 1; : >"$LOG"
                setsid nohup node server/index.js >>"$LOG" 2>&1 </dev/null & ;;
esac
exec tail -n 40 -f "$LOG"
```

### Making the port Public (every start)

- **Forwarded ports reset to Private every time the Codespace restarts.** A Private port answers
  browsers with a GitHub sign-in redirect. That shows up as a CORS or "not valid JSON" failure,
  and the page sticks at "nearly ready".
- The only programmatic way found:
  `gh codespace ports visibility 3000:public -c "$CODESPACE_NAME"`. It needs a **classic**
  personal access token with only the **`codespace`** scope. **Fine-grained tokens can't change
  port visibility**, and neither can the Codespace's built-in token.
- Store that token as a Codespaces secret named `GH_PORTS_TOKEN`, passed to `gh` as `GH_TOKEN`.
- **Do it from the server itself, after it starts listening.** An earlier version used a separate
  helper script, which was unreliable. Retry for about 3 minutes (18 attempts, 10 s apart),
  because port forwarding isn't ready straight away. Record the first failure and the final
  result in `.tutor/port.log`, and expose the latest message in `/api/health`.

```js
// server/port.js (condensed)
export function runGh(args, { token, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(token ? { GH_TOKEN: token } : {}) };
    execFile("gh", args, { env, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true, output: String(stdout).trim() });
      if (err.code === "ENOENT") return resolve({ ok: false, output: "gh isn't installed; rebuild the Codespace" });
      resolve({ ok: false, output: String(stderr || stdout || err.message).trim() });
    });
  });
}
export async function makePortPublic({ codespaceName, port = 3000, token }, { attempts = 18, delayMs = 10_000 } = {}) {
  for (let i = 1; i <= attempts; i += 1) {
    await sleep(delayMs);
    const r = await runGh(["codespace", "ports", "visibility", `${port}:public`, "-c", codespaceName], { token });
    if (r.ok) return record(`Port ${port} is Public (attempt ${i}).`), true;
    if (i === 1) record(`Attempt 1 failed (will keep trying): ${r.output}`);
  }
  record(`Couldn't make port ${port} Public automatically.`); return false;
}
// in server/index.js, inside server.listen(...) callback:
if (config.codespaceName) makePortPublic({ codespaceName: config.codespaceName, port: config.port, token: config.portsToken });
```

### Useful environment variables inside a Codespace

- `CODESPACE_NAME`, e.g. `upgraded-memory-w59vv797wjvc5vgr`.
- `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, usually `app.github.dev`.
- The backend's public address is `https://${CODESPACE_NAME}-${PORT}.${DOMAIN}`. Print it, and
  the Codespace name, at start-up: the user needs both for configuration.

### Server essentials

- `GET /api/health` returns
  `{ ok, ai: { ready, provider, model, errors }, passcodeRequired, port }`. The front end
  uses it to choose its mode.
- **CORS:** echo the `Origin` back only if it's allowed. Answer `OPTIONS` preflights with
  `Access-Control-Allow-Headers: Content-Type, X-Demo-Passcode`.
- Send every error as JSON `{ error }` with a sensible status, so the browser can show it.
- Static files from `web/` are served too, so the app also works at the Codespace's own address.

### Codespaces secrets

- **New or changed secrets only load when the Codespace fully stops and starts again** (or is
  rebuilt). Reloading the browser window isn't enough. This caught us out once.
- Scope each secret to the repository. Never ask the user to print a secret. To check one is
  present, print only the variable names (e.g. `env | grep -o '^GH_PORTS_TOKEN'`).

---

## 5. The Cloudflare "doorbell"

### Why

GitHub Pages is static, and a token in browser JavaScript would be public. The Worker keeps the
token server-side and exposes only two actions. It runs on the free plan.

### GitHub token for the Worker

- **Fine-grained** personal access token, **Only select repositories** → the app's repository.
- **Repository permissions:** **Codespaces: Read-only** and **Codespaces lifecycle admin: Read
  and write**.
- GitHub's error replies name any missing permission in the `x-accepted-github-permissions`
  header. Show it only for 401, 403 and 404, because GitHub sends that header on other errors
  too.

### Worker settings (Cloudflare → Worker → Settings → Variables and Secrets)

| Type | Name | Value |
|---|---|---|
| Secret | `GITHUB_TOKEN` | the fine-grained token above |
| Text | `CODESPACE_NAME` | e.g. `upgraded-memory-w59vv797wjvc5vgr` (the name only, not the URL) |
| Text | `ALLOWED_ORIGIN` | e.g. `https://simonh1982.github.io` (origin only: no path, no trailing slash) |
| Secret | `WAKE_PASSCODE` | optional; the browser sends it as the `X-Wake-Passcode` header |

### Behaviour (`wake/worker.js`)

- `GET /status` returns `{ state }` from `GET https://api.github.com/user/codespaces/{name}`.
  Common states: `Available`, `Shutdown`, `ShuttingDown`, `Starting`, `Queued`, `Provisioning`.
- `POST /wake`:
  - if the state is `Available` or already on the way up, it returns
    `{ state, started: false }`;
  - otherwise it calls `POST /user/codespaces/{name}/start` and returns
    `{ state, started: true }`.
- **`409 Conflict` from `/start`** means "already starting" or "still shutting down". Treat it
  as normal (`started: false`) and let the browser ask again, not as an error.
- GitHub API requests from a Worker **must send a `User-Agent` header**, plus
  `Authorization: Bearer …`, `Accept: application/vnd.github+json` and
  `X-GitHub-Api-Version: 2022-11-28`.
- Reject other origins with 403. Answer `OPTIONS` with CORS headers.

### Deploying without the command line

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Create Worker** ("Hello World").
2. Name it, then **Deploy**.
3. **Edit code**, paste the whole of `worker.js`, then **Deploy**.
4. Add the variables, then **Deploy** again.

A message about Wrangler configuration may appear in the dashboard; it can be ignored for this
set-up. After any change to `worker.js` in the repository, the user must paste it into Cloudflare
again: there is no automatic deploy.

Test by opening `https://<worker>.<account>.workers.dev/status` in a browser.

### Browser side (`web/api.js` → `wakeTutor`)

1. `POST /wake`, then poll the backend's `/api/health` every **5 s** for up to **5 minutes**.
2. Every third check, also read `/status` to show progress. If the state is `Shutdown` and more
   than 30 s have passed since the last ring, **ring again**: the first ring may have arrived
   while it was still shutting down.
3. Show a seconds counter and a plain-English state ("starting up", "nearly ready").
4. If the state has been `Available` for over 90 s without the backend answering, say the
   connection is probably still Private. That was the port problem.

---

## 6. The GitHub Pages front end

- In repository **Settings → Pages**, set **Source: GitHub Actions**. The workflow uploads `web/`
  with `actions/upload-pages-artifact@v3` and `actions/deploy-pages@v4`. It is triggered by
  changes to `web/**`, the workflow file and the version-stamping script.
- **Pages lets browsers keep files for 10 minutes.** Chrome's normal reload re-checks only the
  page, not its scripts. After an update, a page could appear with old JavaScript: a new button
  showed, but did nothing. Firefox re-checks scripts on reload, so it didn't happen there.
- **Fix:** at deploy time, `scripts/stamp-versions.sh web "${GITHUB_SHA::8}"` rewrites:
  - `src="app.js"` and `href="styles.css"` in `index.html`;
  - every relative `from "./x.js"` in every module,

  adding `?v=<commit>`. All imports of one module get the same version, so shared modules still
  load once. The script fails the deploy if any import is missed. The repository files stay
  unversioned, so the Codespace server and local development are unaffected.
- **Finding the backend,** in order:
  1. a `?backend=` link (saved in `localStorage`);
  2. the saved backend;
  3. `DEFAULT_BACKEND` in `web/config.js`;
  4. the page's own origin (when served by the Codespace).

  The first one whose `/api/health` answers is used. If none answers, use the **offline demo**
  and offer **Wake** (when `WAKE_URL` is set).
- Code in `web/shared/` is imported by the browser and by Node. Keep it free of DOM-only and
  Node-only APIs.
- The app saves the user's work in `localStorage`, and gives a **Clear data and restart** button
  with an in-page `<dialog>` warning. `confirm()` is easy to miss, and can't be styled.

---

## 7. Keeping the Codespace alive and affordable

- **Idle timeout:** 30 min by default, 240 max (GitHub → Settings → Codespaces → Default idle
  timeout; applies to Codespaces started afterwards). Requests to a forwarded port **don't**
  count as activity, so a remotely woken Codespace sleeps after the timeout even while in use.
  The page then offers Wake again.
- **Retention:** a Codespace stopped for **30 days** (default and maximum) is deleted. A new one
  has a **new name**, which breaks `CODESPACE_NAME` in Cloudflare and `DEFAULT_BACKEND` in
  `web/config.js`. The owner set up a **scheduled task that wakes it twice a week**, which
  resets the clock.
- **Cost:** every hour the Codespace runs uses the owner's Codespaces allowance; Copilot requests
  use the Copilot allowance. Check current allowances in GitHub's billing settings: they change.
  Use the Wake passcode and AI limits to stop strangers spending them.
- **Token expiry:** all three tokens (Copilot, ports, Worker) expire. When one does, the matching
  feature silently stops (AI errors, port stays Private, Wake errors). Suggest the owner notes the
  expiry dates.

---

## 8. Set-up checklist for a new project

Do these in order, and verify each before moving on.

1. **Repository and Pages:**
   - create the repository, add `web/` and `.github/workflows/pages.yml` (with
     `stamp-versions.sh`), and set **Settings → Pages → Source: GitHub Actions**.
   - *Verify:* the Pages URL loads (offline demo mode).
2. **Codespace:**
   - add `.devcontainer/devcontainer.json` (with the `github-cli` feature), the start-up script,
     and the server;
   - create a Codespace on `main`.
   - *Verify:* `.tutor/start.log` shows the foreground start, and
     `curl -s localhost:3000/api/health` answers.
3. **Copilot:**
   - create the fine-grained token (Copilot Requests) and the `COPILOT_GITHUB_TOKEN` Codespaces
     secret, and optionally `COPILOT_MODEL` (check with `npm run models`);
   - **fully stop and start** the Codespace.
   - *Verify:* the log says `✓ Using copilot (<model>) as <login>`.
4. **Port:**
   - create the classic token (`codespace` scope only) and the `GH_PORTS_TOKEN` secret;
   - stop and start the Codespace.
   - *Verify:* `.tutor/port.log` says "Public", and the Pages site connects (shows live AI).
5. **Doorbell:**
   - create the fine-grained token (Codespaces read, Codespaces lifecycle admin read/write, this
     repository only), the Worker and its variables.
   - *Verify:* `/status` returns a state.
6. **Front-end configuration:** set `WAKE_URL` and `DEFAULT_BACKEND` in `web/config.js`, then
   merge to `main`.
7. **End-to-end test:**
   - stop the Codespace and wait until it shows as stopped;
   - open the Pages site in a **private window**, without the Codespace open, and click Wake.
   - *Expect:* live AI within about 2 minutes.
   - *If not:* check `.tutor/start.log`, `.tutor/tutor.log` and `.tutor/port.log` in that order.
8. **Retention:** remind the owner about the 30-day deletion, and set up a regular wake.

---

## 9. Troubleshooting: symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| AI reply error "Unexpected token 'O', "OK " is not valid JSON" | GitHub Models was retired | Use the Copilot SDK |
| Copilot 403 "not authorized" | No Copilot seat, or the Codespace's own token was used | Fine-grained token with Copilot Requests, from an account with Copilot |
| "No Copilot models are available" / empty model list | Copilot Free | Fall back to fixed models, then `auto` |
| Secret seems ignored, or the wrong model is used | Codespace not restarted since the secret changed | Stop the Codespace fully, then start it |
| Remote wake: Codespace "Available" but no server process, empty logs | Background process killed after `postStartCommand` | Run the server in the foreground in `postStartCommand` |
| `gh: No such file or directory`, exit 127 | Image lacks `gh` | `github-cli` feature, then rebuild |
| Page stuck at "nearly ready"; works after setting the port Public by hand | Port reset to Private on restart | `GH_PORTS_TOKEN` (classic, `codespace` scope); server runs `gh codespace ports visibility` with retries |
| Worker says 409 "already running" plus a permissions hint | 409 treated as an error | Treat 409 as normal; show the permissions hint only for 401/403/404 |
| Worker 401/403/404 | Token missing a permission or repository access | Read `x-accepted-github-permissions` in the error |
| New button visible but does nothing (Chrome only) | Cached old JavaScript | Version-stamp file addresses at deploy; for now, Ctrl + Shift + R |
| `git push` returns 500 after renaming the repository | Old remote URL (case matters) | `git remote set-url origin https://github.com/Owner/New_Name` |
| Ctrl + C in the terminal "stops" the server | It only stops the log tail | Expected; the server keeps running |

---

## 10. Working with this user

- The owner (Simon Hall, Imperial College London Library) is a **GitHub novice**. Give
  numbered, one-action-per-step instructions, saying exactly where to click.
- Put **each terminal command in its own copyable code block, one line each**.
- Write in **UK English** and end answers with a **percentage confidence score**. These are the
  user's standing preferences.
- Never ask them to print or paste a token. For diagnostics, print only variable names or
  yes/no results.
- After changes to `.devcontainer/`, say a rebuild is needed. After server changes, say they need
  `git pull` then `npm run tutor` in the Codespace. After front-end-only changes, merging is
  enough.
- They like to see options with a recommendation, an HTML mock-up before big UI changes, and a
  pull request for each piece of work.
