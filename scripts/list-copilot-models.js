// Lists the Copilot models your account can use, with their relative cost.
// Run inside the Codespace: npm run models   (then set COPILOT_MODEL to choose one)

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CopilotClient } from "@github/copilot-sdk";

const home = join(tmpdir(), "database-search-tutorial-copilot");
mkdirSync(home, { recursive: true });
const token = process.env.COPILOT_GITHUB_TOKEN;
const client = new CopilotClient({ mode: "empty", baseDirectory: home, logLevel: "error", ...(token ? { gitHubToken: token } : { useLoggedInUser: true }) });

try {
  await client.start();
  const auth = await client.getAuthStatus();
  if (!auth?.isAuthenticated) throw new Error("Copilot isn't signed in. Set the COPILOT_GITHUB_TOKEN secret first (see README).");
  console.log(`Signed in as ${auth.login || "unknown"}\n`);
  const models = await client.listModels();
  for (const m of models.sort((a, b) => (a.billing?.multiplier ?? 1) - (b.billing?.multiplier ?? 1))) {
    const cost = typeof m.billing?.multiplier === "number" ? `${m.billing.multiplier}x` : "?";
    const state = m.policy?.state === "disabled" ? "  (disabled)" : "";
    console.log(`${m.id.padEnd(32)} cost ${cost}${state}`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.stop().catch(() => {});
}
