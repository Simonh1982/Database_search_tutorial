// Chooses an AI provider and turns student work into tutor feedback.

import { createCopilotProvider } from "./copilot.js";
import { createMockProvider } from "./mock.js";
import { buildPrompt, MODEL_ANSWER_FROM_ATTEMPT } from "./prompt.js";
import { normaliseFeedback, parseFeedback } from "./parse.js";
import { alignVerdict, applyConsistency, sameWork } from "./memory.js";

function create(name, config) {
  switch (name) {
    case "copilot":
      return createCopilotProvider(config.copilot);
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

// Returns { feedback, repeated }. `repeated` is true when the work hasn't changed since the
// last attempt, in which case the earlier feedback is returned without asking the AI again.
export async function getFeedback(provider, { stage, data, attempt, history, earlier }, options = {}) {
  const { system, user, allowModel, work, previous, approved } = await buildPrompt(stage, data, attempt, { ...options, history, earlier });

  const last = previous.at(-1);
  const lastAllowedModel = last ? last.attempt >= MODEL_ANSWER_FROM_ATTEMPT : false;
  if (last && sameWork(work, last.work) && lastAllowedModel === allowModel) {
    const lastRaw = (Array.isArray(history) ? history : []).filter((h) => h && typeof h === "object" && h.feedback).at(-1);
    return { feedback: normaliseFeedback(lastRaw.feedback, { allowModel }), repeated: true };
  }

  const text = await provider.complete({ system, user, stage, data });
  return { feedback: alignVerdict(applyConsistency(parseFeedback(text, { allowModel }), approved)), repeated: false };
}
