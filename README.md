# Database Search Tutorial

An interactive, AI-guided tutorial that teaches students the fundamentals of searching biomedical
bibliographic databases such as PubMed. **This is a proof of concept** for showing colleagues.

Students work through five stages, getting tutor feedback at each one:

1. **Research question:** focus the question using PICO
2. **Search concepts:** pick the key ideas to search for
3. **Alternative terms:** synonyms, abbreviations, spelling variants and truncation
4. **MeSH:** look up real Medical Subject Headings and choose the right ones
5. **Search strategy:** combine everything with AND / OR / NOT and see live PubMed result counts

## How it works

```
 Colleague's browser                                Your Codespace (on GitHub)
┌──────────────────────────────┐      HTTPS      ┌──────────────────────────────────────┐
│ GitHub Pages (public site)   │ ──────────────▶ │ Tutor server (starts automatically)  │
│ simonh1982.github.io/...     │                 │  ├─ GitHub Copilot SDK ──▶ Copilot AI│
│                              │ ◀────────────── │  │    (your Copilot allowance)       │
│ No server reachable?         │    feedback     │  ├─ skills/*.md  (teaching rules)    │
│ → offline demo with example  │                 │  └─ NCBI E-utilities (MeSH, PubMed)  │
│   feedback (no AI)           │                 └──────────────────────────────────────┘
└──────────────────────────────┘
```

- The **web app** in `web/` is published to GitHub Pages, so anyone with the link can open it.
- The **tutor server** in `server/` runs in *your* Codespace. It asks **GitHub Copilot** for
  feedback, using your Copilot licence (for example the Imperial staff licence).
- What the tutor checks at each stage is written in plain English in `skills/`, one file per stage,
  so librarians can change the teaching without touching any code.
- MeSH headings and PubMed result counts are real, from the US National Library of Medicine.
- At every stage, students can add optional **notes for the tutor** to explain their choices,
  e.g. "I want papers on either triptans or NSAIDs". Only the tutor sees them, at that stage and
  later ones. They are never added to search terms, MeSH look-ups or PubMed searches.
- If the Codespace isn't running, the page switches to an **offline demo**. It gives rule-based
  example feedback instead of AI feedback, so the page always works.

## One-off setup

### 1. Turn on GitHub Pages

1. Merge this work into the `main` branch.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The *Publish web app to GitHub Pages* workflow runs on every change to `web/`. The site
   appears at <https://simonh1982.github.io/Database_search_tutorial/>.

### 2. Let the tutor use your Copilot licence

The server needs a token that allows it to make Copilot requests on your behalf.

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
   → Generate new token**.
2. Give it a name (e.g. "Search tutor"), a sensible expiry date, and under **Permissions** add
   **Copilot Requests**. It doesn't need access to any repositories.
3. Copy the token. Then go to **GitHub → Settings → Codespaces → Secrets → New secret**:
   - Name: `COPILOT_GITHUB_TOKEN`
   - Value: the token
   - Repository access: `Simonh1982/Database_search_tutorial`

**Don't have Copilot through work yet?** You can test with **Copilot Free** on your personal GitHub
account. Go to <https://github.com/settings/copilot> and turn it on, then create the token as above.
Its monthly allowance is small, but it's enough to try the tutor. Without a working token, the app
still runs, but it gives example feedback instead of AI feedback.

(Earlier versions also fell back to GitHub Models. GitHub retired that service on 30 July 2026.)

### 3. (Optional) Add a passcode

To stop strangers using your allowance, add another Codespaces secret called `DEMO_PASSCODE`. Give
the passcode to colleagues: the page asks for it the first time they request feedback.

### 4. (Recommended) Keep the Codespace awake for longer

A Codespace **stops after 30 minutes without activity** by default (see *What "sleeping" means*
below). For a demo session, raise this in **GitHub → Settings → Codespaces → Default idle timeout**
(the maximum is 240 minutes).

## Running a demo session

1. On the repository page, click **Code → Codespaces**. Re-open your existing Codespace (its
   address stays the same), or create one on `main`.
2. The tutor starts automatically whenever the Codespace starts, and its output appears in the
   terminal. Check it says `✓ Using copilot (model name) as your-username`.
3. In the terminal, run:

   ```bash
   npm run share
   ```

   This makes port 3000 public and prints a link like
   `https://simonh1982.github.io/Database_search_tutorial/?backend=…`. Send that link to colleagues.
   Their browser remembers the server, so later visits to the plain address also connect.
4. When you've finished, stop the Codespace (**Code → Codespaces → … → Stop codespace**), or let it
   time out. Visitors then get the offline demo, or a **Wake the tutor** button if it's set up
   (see below).

**After updating the code** (`git pull`), restart the tutor with `npm run tutor`. The tutor runs in
the background: pressing **Ctrl + C** only stops *showing* its output, not the tutor itself.
If an update changes `.devcontainer/devcontainer.json` (the Codespace's set-up), rebuild once:
press **Ctrl + Shift + P** (**Cmd + Shift + P** on a Mac), type `Rebuild Container`, and choose
**Codespaces: Rebuild Container**. Your files and the Codespace's name are kept.

**Tip:** if you always reuse the same Codespace, you can put its address in `web/config.js`.
The plain Pages address then connects without needing the `?backend=` part.

### What "sleeping" means

A Codespace is a virtual computer that GitHub runs for you. To save your free hours, GitHub shuts
it down when nobody has used it for a while: 30 minutes by default. Visitors to the public
page don't count as activity. While it's stopped, the tutor server isn't running, so the page
shows **Offline demo · example feedback**. Restarting the Codespace (step 1 above) brings it back
at the same address, so links you've already shared still work.

Stopped Codespaces are **deleted after 30 days** of not being used (GitHub's default retention
period). If that happens, create a new one; it gets a new name and address, so update
`web/config.js` and the wake-up button's `CODESPACE_NAME`.

## Wake-up button

With this set up, colleagues see **"The AI tutor is asleep – Wake the tutor"** on the public page
when your Codespace is stopped. One click starts it; the page connects by itself when the tutor is
ready (usually 1–2 minutes).

**How it works:** the button calls a tiny "doorbell" program on **Cloudflare Workers** (free).
The doorbell holds a GitHub key that can only check and start your Codespaces; the key never
reaches the browser. The doorbell's code is in `wake/worker.js`.

### A. Create the GitHub key

1. GitHub → your profile picture → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Token name:** `Tutor wake-up`. **Expiration:** your choice (e.g. 90 days).
3. **Repository access:** **Only select repositories** → `Database_search_tutorial`.
4. **Permissions → Repository permissions:**
   - **Codespaces:** Read-only
   - **Codespaces lifecycle admin:** Read and write
5. **Generate token** and copy it (it starts `github_pat_`).

### B. Create the doorbell on Cloudflare

1. Sign up (free) at <https://dash.cloudflare.com/sign-up> and verify your email address.
2. In the left-hand menu, open **Workers & Pages** (sometimes under **Compute**), then click
   **Create** → **Create Worker** (or **Start with Hello World!**).
3. Name it `tutor-wake` and click **Deploy**.
4. Click **Edit code**. Delete everything in the editor, then paste in the whole of
   [`wake/worker.js`](wake/worker.js) (open it on GitHub and use the **Copy raw file** button).
   Click **Deploy**.
5. Go back to the Worker, open **Settings → Variables and Secrets**, and add these four:

   | Type | Name | Value |
   |---|---|---|
   | Secret | `GITHUB_TOKEN` | the key from part A |
   | Text | `CODESPACE_NAME` | your Codespace's name (shown as `Codespace name:` when the tutor starts) |
   | Text | `ALLOWED_ORIGIN` | `https://simonh1982.github.io` |
   | Secret | `WAKE_PASSCODE` | optional: a passcode colleagues must enter (can be the same as `DEMO_PASSCODE`) |

   Save or **Deploy** when asked.
6. Copy the Worker's address, shown on its overview page, e.g.
   `https://tutor-wake.your-name.workers.dev`.
7. **Test it:** open that address followed by `/status` in your browser. You should see something
   like `{"state":"Available"}` or `{"state":"Shutdown"}`. If you see an error, it names what's
   missing (for example a token permission).

### C. Connect the page to the doorbell

In `web/config.js`, set `WAKE_URL` to the Worker's address and `DEFAULT_BACKEND` to your
Codespace's address (shown as `Codespace address:` when the tutor starts). After the change
reaches `main`, the public page offers the wake-up button whenever the tutor is asleep.

**Good to know:**
- Each wake-up uses your Codespace hours until it goes back to sleep (after the idle timeout).
  The passcode stops strangers waking it.
- When the Codespace is woken remotely, nobody has it open, so it goes back to sleep after the idle
  timeout even if colleagues are using it. The page then offers the wake-up button again.
- After waking, the port must still be **Public** for the page to connect. The Codespace tries to
  set this automatically when it starts. If the page never connects after waking, open the
  Codespace, go to the **PORTS** tab and check port 3000 is set to Public.

## Cost and safety controls

Every **Submit** is one AI request. These limits stop a public link from using up your Copilot
allowance. Set them as Codespaces secrets, or before `npm start` (e.g. `AI_DAILY_LIMIT=100 npm start`).

| Setting | Default | What it does |
|---|---|---|
| `AI_PROVIDER` | `copilot` | Which AI to use (`mock` = no AI, for testing) |
| `COPILOT_MODEL` | cheapest "mini" model, or the first fixed model that answers | Which Copilot model to use. `npm run models` lists them with their cost |
| `AI_DAILY_LIMIT` | `300` | AI requests per day, all visitors combined |
| `AI_PER_IP_LIMIT` / `AI_PER_IP_WINDOW` | `40` per `60` min | AI requests per visitor |
| `DEMO_PASSCODE` | none | Passcode required for AI feedback |
| `ALLOWED_ORIGINS` | the Pages site and localhost | Websites allowed to call the server |
| `NCBI_API_KEY` | none | Optional NCBI key for higher MeSH/PubMed look-up limits |

Each request contains only the current stage's work, the tutor's instructions, and a short record
of earlier feedback (see below), so requests stay small and cheap.

## How the tutor stays consistent

AI models don't remember earlier conversations, and they can give different answers to the same
question. To stop the tutor contradicting itself:

- **It sees its earlier feedback.** Each request includes the student's last three attempts at
  the stage, with the feedback given each time, and the latest feedback on earlier stages.
- **Changes are worked out in code.** The server compares the new work with the previous attempt.
  Anything the tutor called good last time that the student hasn't changed is listed as "already
  approved". It stays "Good", keeps its earlier comment, and is marked *Unchanged since your last
  submission*, whatever the AI says the second time.
- **Identical resubmissions aren't sent to the AI.** The student sees the same feedback again,
  which also saves Copilot allowance. (The exception is attempt 3, when a worked example first
  becomes available.)
- **The overall verdict matches the items.** If every item is good, the verdict is "Strong".
- **A fixed model is used where possible.** Copilot's "auto" setting can switch models between
  requests, so the tutor tries fixed models first. To choose one yourself, set the
  `COPILOT_MODEL` Codespaces secret (e.g. `gpt-5-mini`). On a Copilot Free account it also
  helps to turn off **Evaluation models in Copilot auto model selection** at
  <https://github.com/settings/copilot>.

The rules the tutor follows about consistency are in `skills/tutor/SKILL.md`.

## Changing what the tutor teaches

Edit the Markdown files in `skills/`:

| File | Used for |
|---|---|
| `skills/tutor/SKILL.md` | The tutor's persona and rules for every stage (tone, "coach, don't do", boundaries) |
| `skills/stage1-pico/SKILL.md` … `skills/stage5-boolean/SKILL.md` | What good work looks like at each stage |

Changes take effect on the next request; you don't need to restart. Students get hints for their
first two attempts at a stage. From the third attempt the tutor may offer a worked example, which
they can choose to reveal (`MODEL_ANSWER_FROM_ATTEMPT` in `server/ai/prompt.js`).

## Project layout

```
web/                 The web app (static files, published to GitHub Pages)
  app.js             The five stages
  api.js             Connects to the tutor server, or falls back to the offline demo
  config.js          Optional default server address
  shared/            Code used by both browser and server (NCBI look-ups, search syntax, demo feedback)
server/              The tutor server (Node.js), run in the Codespace
  ai/                Copilot and mock providers; prompt building; reply parsing
skills/              The tutor's teaching instructions, one folder per stage
scripts/             `npm run tutor`, `npm run share` and `npm run models`
wake/                The "Wake the tutor" doorbell, deployed on Cloudflare Workers
test/                Automated tests (`npm test`)
.devcontainer/       Codespace setup: installs dependencies and starts the server
```

## Development

```bash
npm install
npm run dev     # runs with the mock provider (no AI, no cost) at http://localhost:3000
npm test
```

## Known limitations of this proof of concept

- Progress is saved only in the student's own browser. There are no accounts and nothing is stored on the server.
- The server keeps rate limits in memory, so they reset when it restarts.
- In the offline demo, MeSH and PubMed look-ups go straight from the browser to NCBI. If a network
  blocks this, they work only while the Codespace is connected.
- Feedback comes from AI and can be wrong. The tutor is told to rely only on the MeSH data and
  result counts the app supplies, but librarians should review its responses before wider use.
