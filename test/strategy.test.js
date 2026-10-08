import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlock, checkSyntax, combineBlocks, keywordTerm, parseTerms } from "../web/shared/strategy.js";

test("parseTerms splits lines and semicolons, keeps commas, and removes duplicates", () => {
  assert.deepEqual(parseTerms("child*\nkids; Kids;  young  people \n\n"), ["child*", "kids", "young people"]);
  assert.deepEqual(parseTerms("diabetes mellitus, type 2\nT2DM"), ["diabetes mellitus, type 2", "T2DM"]);
});

test("keywordTerm quotes phrases and keeps existing field tags", () => {
  assert.equal(keywordTerm("asthma"), "asthma[tiab]");
  assert.equal(keywordTerm("physical activity"), '"physical activity"[tiab]');
  assert.equal(keywordTerm('"physical activity"'), '"physical activity"[tiab]');
  assert.equal(keywordTerm("exercise[mh]"), "exercise[mh]");
});

test("buildBlock ORs MeSH and keywords without duplicates", () => {
  const block = buildBlock({ concept: "Exercise", synonyms: ["exercise", "physical activity"], meshHeadings: ["Exercise"] });
  assert.equal(block, '("Exercise"[Mesh] OR Exercise[tiab] OR "physical activity"[tiab])');
  assert.equal(buildBlock({ concept: "asthma" }), "asthma[tiab]");
  assert.equal(buildBlock({}), "");
});

test("combineBlocks needs an operator in every gap", () => {
  assert.equal(combineBlocks(["(a)", "(b)", "(c)"], ["AND", "AND"]), "(a) AND (b) AND (c)");
  assert.equal(combineBlocks(["(a)", "(b)"], [""]), "");
  assert.equal(combineBlocks(["(a)"], []), "(a)");
});

test("combineBlocks brackets alternatives joined by OR before combining with AND", () => {
  assert.equal(combineBlocks(["migraine", "triptans", "NSAIDs"], ["AND", "OR"]), "migraine AND (triptans OR NSAIDs)");
  assert.equal(combineBlocks(["a", "b", "c", "d"], ["OR", "AND", "NOT"]), "(a OR b) AND c NOT d");
  assert.equal(combineBlocks(["a", "b"], ["OR"]), "(a OR b)");
});

test("checkSyntax spots unbalanced brackets, quotes and lower-case operators", () => {
  assert.deepEqual(checkSyntax('("a"[tiab] OR b[tiab]) AND c'), []);
  assert.equal(checkSyntax("(a OR b").length, 1);
  assert.equal(checkSyntax('"a OR b').length, 1);
  assert.match(checkSyntax("a and b").join(), /capitals/);
  assert.deepEqual(checkSyntax('"salt and pepper"[tiab]'), []);
});
