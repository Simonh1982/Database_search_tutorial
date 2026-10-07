// GitHub Copilot provider, using the Copilot SDK (https://github.com/github/copilot-sdk).
// Requests are billed to the signed-in Copilot user (e.g. an Imperial staff Copilot licence).

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rejectTools = () => ({ kind: "reject", feedback: "Tools are not available in this tutor." });

// Prefer an inexpensive "mini" model; otherwise the lowest-cost model available.
export function chooseModel(models, preferred = "") {
  const usable = models.filter((m) => m?.id && m.policy?.state !== "disabled");
  if (preferred) {
    if (usable.some((m) => m.id === preferred)) return preferred;
    throw new Error(`Copilot model "${preferred}" isn't available to this account. Run "npm run models" to list the options.`);
  }
  const cost = (m) => (typeof m.billing?.multiplier === "number" ? m.billing.multiplier : 1);
  const mini = (m) => (/mini|flash|haiku/i.test(m.id) ? 0 : 1);
  const sorted = [...usable].sort((a, b) => mini(a) - mini(b) || cost(a) - cost(b));
  if (!sorted[0]) throw new Error("No Copilot models are available to this account.");
  return sorted[0].id;
}

export function createCopilotProvider({ token = "", model = "" } = {}) {
  let client;
  let chosenModel = "";
  let login = "";

  return {
    name: "copilot",
    get model() {
      return chosenModel;
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
      await client.start();

      const auth = await client.getAuthStatus();
      if (!auth?.isAuthenticated) {
        await this.stop();
        throw new Error(
          "Copilot isn't signed in. Add a COPILOT_GITHUB_TOKEN Codespaces secret (see README) and restart the server.",
        );
      }
      login = auth.login || "";
      chosenModel = chooseModel(await client.listModels(), model);
    },

    async complete({ system, user }) {
      const session = await client.createSession({
        model: chosenModel,
        systemMessage: { mode: "replace", content: system },
        availableTools: [],
        infiniteSessions: { enabled: false },
        onPermissionRequest: rejectTools,
      });
      try {
        const reply = await session.sendAndWait({ prompt: user }, 90_000);
        return reply?.data?.content ?? "";
      } finally {
        await session.disconnect().catch(() => {});
      }
    },

    async stop() {
      if (client) await client.stop().catch(() => {});
      client = undefined;
    },
  };
}
