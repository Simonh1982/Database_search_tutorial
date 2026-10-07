// Mock provider: returns the offline demo's rule-based feedback. No AI, no cost.
// Use it for development and tests: AI_PROVIDER=mock npm start

import { demoFeedback } from "../../web/shared/demo.js";

export function createMockProvider() {
  return {
    name: "mock",
    model: "rule-based",
    account: "",
    async start() {},
    async complete({ stage, data }) {
      return JSON.stringify(demoFeedback(stage, data));
    },
    async stop() {},
  };
}
