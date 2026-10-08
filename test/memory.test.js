import { test } from "node:test";
import assert from "node:assert/strict";
import { alignVerdict, approvedAndUnchanged, applyConsistency, earlierStages, itemValues, previousAttempts } from "../server/ai/memory.js";
import { buildPrompt, sanitiseWork } from "../server/ai/prompt.js";
import { getFeedback } from "../server/ai/index.js";

const question = "In adults with type 2 diabetes, does exercise improve HbA1c?";

// The student's first attempt at stage 2 and the tutor's feedback on it.
const firstAttempt = {
  attempt: 1,
  work: { question, concepts: ["type 2 diabetes", "effect of exercise", "HbA1c"] },
  feedback: {
    verdict: "developing",
    summary: "Two good concepts; one needs work.",
    items: [
      { label: "type 2 diabetes", status: "strong", comment: "A clear, searchable population." },
      { label: "effect of exercise", status: "developing", comment: "Remove the generic word 'effect'." },
      { label: "HbA1c", status: "strong", comment: "A specific, measurable outcome." },
    ],
    suggestions: ["Remove 'effect of'."],
  },
};
const secondWork = { question, concepts: ["type 2 diabetes", "exercise", "HbA1c"] };

// A provider that contradicts its earlier feedback, like the behaviour seen in testing.
function contradictoryProvider() {
  const calls = [];
  return {
    calls,
    async complete(args) {
      calls.push(args);
      return JSON.stringify({
        verdict: "developing",
        summary: "Better.",
        items: [
          { label: "type 2 diabetes", status: "developing", comment: "Should be split into two concepts." },
          { label: "exercise", status: "strong", comment: "Good." },
        ],
      });
    },
  };
}

test("itemValues describes each item so changes can be detected", () => {
  const work = sanitiseWork(3, { question, concepts: [{ concept: "Exercise", synonyms: ["training", "physical activity"] }] });
  assert.equal(itemValues(3, work).get("exercise"), "physical activity|training");
  assert.equal(itemValues(1, sanitiseWork(1, { question })).size, 0);
});

test("approvedAndUnchanged finds items approved last time that the student hasn't changed", () => {
  const previous = previousAttempts(2, [firstAttempt], sanitiseWork);
  const approved = approvedAndUnchanged(2, sanitiseWork(2, secondWork), previous);
  assert.deepEqual(approved.map((i) => i.label), ["type 2 diabetes", "HbA1c"]);
});

test("approved items are no longer locked once the student changes them", () => {
  const previous = previousAttempts(3, [
    {
      attempt: 1,
      work: { question, concepts: [{ concept: "exercise", synonyms: ["training"] }] },
      feedback: { items: [{ label: "exercise", status: "strong", comment: "Good." }] },
    },
  ], sanitiseWork);
  const changed = sanitiseWork(3, { question, concepts: [{ concept: "exercise", synonyms: ["training", "sport"] }] });
  assert.deepEqual(approvedAndUnchanged(3, changed, previous), []);
});

test("applyConsistency keeps approved items approved, with the earlier comment", () => {
  const approved = [{ label: "type 2 diabetes", status: "strong", comment: "A clear, searchable population." }, { label: "HbA1c", status: "strong", comment: "Measurable." }];
  const out = applyConsistency({ items: [{ label: "Type 2 Diabetes", status: "developing", comment: "Split it." }] }, approved);
  assert.equal(out.items[0].status, "strong");
  assert.equal(out.items[0].comment, "A clear, searchable population.");
  assert.equal(out.items[0].unchanged, true);
  assert.equal(out.items[1].label, "HbA1c"); // added back when the model left it out
});

test("alignVerdict marks the work strong when every item is good", () => {
  assert.equal(alignVerdict({ verdict: "developing", items: [{ status: "strong" }, { status: "strong" }] }).verdict, "strong");
  assert.equal(alignVerdict({ verdict: "developing", items: [{ status: "strong" }, { status: "missing" }] }).verdict, "developing");
  assert.equal(alignVerdict({ verdict: "developing", items: [] }).verdict, "developing");
});

test("earlierStages keeps only stages before the current one", () => {
  const earlier = earlierStages(3, [{ stage: 1, feedback: firstAttempt.feedback }, { stage: 3, feedback: {} }, { stage: 4, feedback: {} }]);
  assert.deepEqual(earlier.map((e) => e.stage), [1]);
  assert.deepEqual(earlier[0].items[0], { label: "type 2 diabetes", status: "strong" });
});

test("the prompt shows earlier feedback and lists approved, unchanged items", async () => {
  const { user } = await buildPrompt(2, secondWork, 2, { history: [firstAttempt], earlier: [{ stage: 1, feedback: { summary: "Clear PICO.", items: [] } }] });
  assert.match(user, /<previous_attempts>/);
  assert.match(user, /Remove the generic word 'effect'/);
  assert.match(user, /ALREADY APPROVED AND UNCHANGED.*"type 2 diabetes".*"HbA1c"/);
  assert.match(user, /<earlier_stages>[\s\S]*Clear PICO/);
});

test("getFeedback stops the tutor contradicting itself on unchanged items", async () => {
  const provider = contradictoryProvider();
  const { feedback, repeated } = await getFeedback(provider, { stage: 2, data: secondWork, attempt: 2, history: [firstAttempt] });
  assert.equal(repeated, false);
  const t2d = feedback.items.find((i) => i.label === "type 2 diabetes");
  assert.equal(t2d.status, "strong");
  assert.equal(t2d.unchanged, true);
  assert.equal(feedback.items.find((i) => i.label === "exercise").status, "strong");
  assert.ok(feedback.items.some((i) => i.label === "HbA1c" && i.status === "strong"));
  assert.equal(feedback.verdict, "strong");
});

test("resubmitting identical work returns the same feedback without asking the AI", async () => {
  const provider = contradictoryProvider();
  const { feedback, repeated } = await getFeedback(provider, { stage: 2, data: firstAttempt.work, attempt: 2, history: [firstAttempt] });
  assert.equal(repeated, true);
  assert.equal(provider.calls.length, 0);
  assert.equal(feedback.summary, "Two good concepts; one needs work.");
});

test("identical work still goes to the AI when a worked example becomes available", async () => {
  const provider = contradictoryProvider();
  const history = [{ ...firstAttempt, attempt: 2 }];
  const { repeated } = await getFeedback(provider, { stage: 2, data: firstAttempt.work, attempt: 3, history });
  assert.equal(repeated, false);
  assert.equal(provider.calls.length, 1);
});

test("history from the browser is tolerated when missing or malformed", async () => {
  const provider = contradictoryProvider();
  for (const history of [undefined, null, "nonsense", [null, 5, {}]]) {
    const { repeated } = await getFeedback(provider, { stage: 2, data: secondWork, attempt: 1, history });
    assert.equal(repeated, false);
  }
});
