// Chooses an AI provider and turns student work into tutor feedback.

import { createCopilotProvider } from "./copilot.js";
import { createGitHubModelsProvider } from "./githubModels.js";
import { createMockProvider } from "./mock.js";
import { buildPrompt } from "./prompt.js";
import { parseFeedback } from "./parse.js";

function create(name, config) {
  switch (name) {
    case "copilot":
      return createCopilotProvider(config.copilot);
    case "github-models":
      return createGitHubModelsProvider(config.githubModels);
    case "mock":
      return createMockProvider();
    default:
      throw new Error(`Unknown AI provider "${name}".`);
  }
}

// Try each configured provider in order and keep the first that starts.
export async function startAI(config, { log = console.log } = {}) {
  const errors = [];
  for (const name of config.providers) {
    try {
      const provider = create(name, config);
      await provider.start();
      return { provider, errors };
    } catch (err) {
      errors.push({ provider: name, message: err.message });
      log(`  ✗ ${name}: ${err.message}`);
    }
  }
  return { provider: null, errors };
}

export async function getFeedback(provider, { stage, data, attempt }, options) {
  const { system, user, allowModel } = await buildPrompt(stage, data, attempt, options);
  const text = await provider.complete({ system, user, stage, data });
  return parseFeedback(text, { allowModel });
}
