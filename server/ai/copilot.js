// GitHub Copilot provider, using the Copilot SDK (https://github.com/github/copilot-sdk).
// Requests are billed to the signed-in Copilot user (e.g. an Imperial staff Copilot licence).

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rejectTools = () => ({ kind: "reject", feedback: "Tools are not available in this tutor." });

// Copilot's own automatic model choice. It can switch models between requests, which makes
// feedback less consistent, so fixed models are tried first when no model list is available.
export const AUTO_MODEL = "auto";
export const FIXED_MODELS_TO_TRY = ["gpt-5-mini", "gpt-4.1"];

// Prefer an inexpensive "mini" model; otherwise the lowest-cost model available.
// Returns "" when the list is empty, meaning "let Copilot choose".
export function chooseModel(models, preferred = "") {
  const usable = models.filter((m) => m?.id && m.policy?.state !== "disabled");
  if (preferred) {
    if (models.length === 0 || usable.some((m) => m.id === preferred)) return preferred;
    throw new Error(`Copilot model "${preferred}" isn't available to this account. Run "npm run models" to list the options.`);
  }
  if (models.length === 0) return "";
  const cost = (m) => (typeof m.billing?.multiplier === "number" ? m.billing.multiplier : 1);
  const mini = (m) => (/mini|flash|haiku/i.test(m.id) ? 0 : 1);
  const sorted = [...usable].sort((a, b) => mini(a) - mini(b) || cost(a) - cost(b));
  if (!sorted[0]) throw new Error("All Copilot models are switched off for this account.");
  return sorted[0].id;
}

// Copilot errors can include a long JSON dump of HTTP headers; keep just the useful part.
export function shortError(err) {
  const message = String(err?.message ?? err ?? "Unknown error");
  const body = message.match(/"body":"((?:[^"\\]|\\.)*)"/);
  const text = body ? body[1].replace(/\\n/g, " ").trim() : message;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export function createCopilotProvider({ token = "", model = "" } = {}) {
  let client;
  let chosenModel = "";
  let login = "";

  async function ask(modelId, system, prompt, timeoutMs) {
    const session = await client.createSession({
      ...(modelId ? { model: modelId } : {}),
      systemMessage: { mode: "replace", content: system },
      availableTools: [],
      infiniteSessions: { enabled: false },
      onPermissionRequest: rejectTools,
    });
    try {
      const reply = await session.sendAndWait({ prompt }, timeoutMs);
      return reply?.data?.content ?? "";
    } finally {
      await session.disconnect().catch(() => {});
    }
  }

  return {
    name: "copilot",
    get model() {
      return chosenModel || "Copilot default";
    },
    get account() {
      return login;
    },

    async start() {
      const { CopilotClient } = await import("@github/copilot-sdk");
      const home = join(tmpdir(), "database-search-tutorial-copilot");
      mkdirSync(home, { recursive: true });

      client = new CopilotClient({
        mode: "empty",
        baseDirectory: home,
        workingDirectory: home,
        logLevel: "error",
        ...(token ? { gitHubToken: token } : { useLoggedInUser: true }),
      });

      try {
        await client.start();
        const auth = await client.getAuthStatus();
        if (!auth?.isAuthenticated) {
          throw new Error("Copilot isn't signed in. Add a COPILOT_GITHUB_TOKEN Codespaces secret (see README) and restart.");
        }
        login = auth.login || "";

        // Some accounts (e.g. Copilot Free) return an empty model list; then let Copilot choose.
        const models = await client.listModels().catch(() => []);
        const picked = chooseModel(models, model);
        const candidates = picked ? [picked] : [...FIXED_MODELS_TO_TRY, AUTO_MODEL, ""];

        // Send one tiny test message so "ready" really means Copilot answers.
        let lastError;
        for (const candidate of candidates) {
          try {
            const reply = await ask(candidate, "Reply with the single word OK.", "Test", 60_000);
            if (!reply.trim()) throw new Error("Copilot sent an empty reply.");
            chosenModel = candidate;
            return;
          } catch (err) {
            lastError = err;
          }
        }
        throw new Error(`Copilot is signed in but didn't answer a test message: ${shortError(lastError)}`);
      } catch (err) {
        await this.stop();
        throw new Error(shortError(err));
      }
    },

    async complete({ system, user }) {
      try {
        return await ask(chosenModel, system, user, 90_000);
      } catch (err) {
        throw new Error(shortError(err));
      }
    },

    async stop() {
      if (client) await client.stop().catch(() => {});
      client = undefined;
    },
  };
}
