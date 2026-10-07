import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, sanitiseWork, stripFrontMatter } from "../server/ai/prompt.js";
import { extractJson, parseFeedback } from "../server/ai/parse.js";
import { chooseModel, shortError } from "../server/ai/copilot.js";
import { demoFeedback } from "../web/shared/demo.js";

test("stripFrontMatter removes the YAML header", () => {
  assert.equal(stripFrontMatter("---\nname: x\n---\n\n# Body"), "# Body");
});

test("buildPrompt combines the tutor and stage skills and withholds worked examples early", async () => {
  const first = await buildPrompt(2, { question: "Q?", concepts: ["exercise"] }, 1);
  assert.match(first.system, /health sciences librarian/);
  assert.match(first.system, /Search Concept|search concepts/i);
  assert.match(first.system, /"verdict"/);
  assert.match(first.user, /NOT allowed/);
  assert.match(first.user, /"exercise"/);
  assert.equal(first.allowModel, false);

  const third = await buildPrompt(2, { question: "Q?", concepts: ["exercise"] }, 3);
  assert.equal(third.allowModel, true);
  assert.match(third.user, /IS allowed/);
});

test("buildPrompt rejects unknown stages", async () => {
  await assert.rejects(() => buildPrompt(9, {}, 1));
});

test("sanitiseWork limits sizes and keeps only expected fields", () => {
  const work = sanitiseWork(2, { question: "x".repeat(5000), concepts: Array(10).fill("c"), extra: "ignored" });
  assert.equal(work.concepts.length, 5);
  assert.ok(work.researchQuestion.length <= 1001);
  assert.equal(work.extra, undefined);
});

test("extractJson copes with code fences and surrounding text", () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a": 1}\n```'), { a: 1 });
  assert.equal(extractJson("no json here"), null);
});

test("parseFeedback normalises fields and hides model answers when not allowed", () => {
  const text = JSON.stringify({
    verdict: "excellent",
    summary: "Good",
    strengths: ["a", 2, "b"],
    items: [{ label: "Population (P)", status: "great", comment: "ok" }],
    modelAnswer: "secret",
  });
  const f = parseFeedback(text, { allowModel: false });
  assert.equal(f.verdict, "developing");
  assert.deepEqual(f.strengths, ["a", "b"]);
  assert.equal(f.items[0].status, "developing");
  assert.equal(f.modelAnswer, "");
  assert.equal(parseFeedback(text, { allowModel: true }).modelAnswer, "secret");
});

test("parseFeedback falls back to showing plain text", () => {
  assert.equal(parseFeedback("Just some advice.").summary, "Just some advice.");
});

test("chooseModel lets Copilot choose when the model list is empty", () => {
  assert.equal(chooseModel([]), "");
  assert.equal(chooseModel([], "gpt-5-mini"), "gpt-5-mini");
  assert.throws(() => chooseModel([{ id: "a", policy: { state: "disabled" } }]), /switched off/);
});

test("shortError keeps just the readable part of Copilot errors", () => {
  const raw = 'Request models.list failed with message: GenericFailure, {"kind":"http","status":403,"body":"unauthorized: not authorized to use this Copilot feature\\n","headers":[{"name":"date"}]}';
  assert.equal(shortError(new Error(raw)), "unauthorized: not authorized to use this Copilot feature");
  assert.equal(shortError(new Error("Plain message")), "Plain message");
});

test("chooseModel prefers an enabled mini model, and honours a configured one", () => {
  const models = [
    { id: "gpt-5", billing: { multiplier: 1 } },
    { id: "gpt-5-mini", billing: { multiplier: 0 } },
    { id: "cheap-but-disabled-mini", billing: { multiplier: 0 }, policy: { state: "disabled" } },
  ];
  assert.equal(chooseModel(models), "gpt-5-mini");
  assert.equal(chooseModel(models, "gpt-5"), "gpt-5");
  assert.throws(() => chooseModel(models, "nope"), /isn't available/);
});

test("demo feedback flags generic words and OR between concepts", () => {
  const s2 = demoFeedback(2, { concepts: ["effect of exercise", "asthma"] });
  assert.equal(s2.items[0].status, "developing");
  assert.equal(s2.items[1].status, "strong");
  const s5 = demoFeedback(5, { blocks: [{ concept: "a", count: 10 }, { concept: "b" }], operators: ["OR"], count: 500000 });
  assert.equal(s5.verdict, "developing");
  assert.match(s5.summary, /very broad/);
});
