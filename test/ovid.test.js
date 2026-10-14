import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildOvidHistory,
  checkTerm,
  convertTerms,
  ovidHeading,
  ovidKeywordLine,
  ovidTermToPubmed,
  pubmedTermToOvid,
  translateOvidHistory,
  translateOvidLine,
} from "../web/shared/ovid.js";
import { buildBlock, meshTerm } from "../web/shared/strategy.js";

const kinds = (r) => r.changes.filter((c) => c.kind !== "same").map((c) => [c.kind, c.ovid]);

test("ovidHeading and ovidKeywordLine write Ovid lines", () => {
  assert.equal(ovidHeading("Child"), "exp Child/");
  assert.equal(ovidHeading("Adolescent", false), "Adolescent/");
  assert.equal(ovidKeywordLine(["migrain*"]), "migrain*.ti,ab.");
  assert.equal(ovidKeywordLine(["children", "child*", "Children", "school adj2 age*"]), "(children or child* or (school adj2 age*)).ti,ab.");
  assert.equal(ovidKeywordLine([]), "");
});

test("subject headings translate to MeSH tags", () => {
  assert.equal(translateOvidLine("exp Child/").pubmed, '"Child"[Mesh]');
  assert.equal(translateOvidLine("Adolescent/").pubmed, '"Adolescent"[Mesh:NoExp]');
  assert.equal(translateOvidLine("exp *Migraine Disorders/").pubmed, '"Migraine Disorders"[Majr]');
  assert.equal(translateOvidLine("*Migraine Disorders/").pubmed, '"Migraine Disorders"[Majr:NoExp]');
  assert.equal(translateOvidLine("exp Anti-Inflammatory Agents, Non-Steroidal/").pubmed, '"Anti-Inflammatory Agents, Non-Steroidal"[Mesh]');
  const sub = translateOvidLine("Migraine Disorders/dt");
  assert.equal(sub.pubmed, '"Migraine Disorders"[Mesh:NoExp]');
  assert.deepEqual(kinds(sub), [["check", "/dt"]]);
});

test("truncation, fields and phrases translate exactly", () => {
  const r = translateOvidLine("migrain*.ti,ab.");
  assert.equal(r.pubmed, "migrain*[tiab]");
  assert.deepEqual(kinds(r), []);
  assert.equal(translateOvidLine("migrain$.tw.").pubmed, "migrain*[tiab]");
  assert.equal(translateOvidLine("abdominal migraine.ti,ab.").pubmed, '"abdominal migraine"[tiab]');
  assert.equal(translateOvidLine("abdominal migrain*.ti.").pubmed, '"abdominal migrain*"[ti]');
});

test("one-letter wildcards are listed as spellings", () => {
  assert.equal(translateOvidLine("p?ediatric*.ti,ab.").pubmed, "(pediatric*[tiab] OR paediatric*[tiab])");
  assert.equal(translateOvidLine("colo?r.ti,ab.").pubmed, "(color[tiab] OR colour[tiab])");
  assert.equal(translateOvidLine("randomi#ed.ti,ab.").pubmed, "(randomised[tiab] OR randomized[tiab])");
  assert.equal(translateOvidLine("an?emia.ti,ab.").pubmed, "(anemia[tiab] OR anaemia[tiab])");
  assert.equal(translateOvidLine("diarrh?ea.ti,ab.").pubmed, "(diarrhea[tiab] OR diarrhoea[tiab])");
  // No spelling rule fits and there are fewer than 4 letters before it: every vowel is tried.
  const w = translateOvidLine("wom#n.ti,ab.");
  assert.match(w.pubmed, /woman\[tiab\] OR women\[tiab\]/);
  assert.deepEqual(kinds(w), [["listed", "wom#n"]]);
  // With 4 or more letters first, PubMed's own * inside a word is used instead.
  const s = translateOvidLine("sulfon#lurea.ti,ab.");
  assert.equal(s.pubmed, "sulfon*lurea[tiab]");
  assert.deepEqual(kinds(s), [["close", "sulfon#lurea"]]);
});

test("limited truncation and short stems are listed", () => {
  const boy = translateOvidLine("boy*1.ti,ab.");
  assert.equal(boy.pubmed, "(boy[tiab] OR boys[tiab])");
  assert.deepEqual(kinds(boy), [["listed", "boy*1"]]);
  assert.equal(translateOvidLine("girl$1.ti,ab.").pubmed, "(girl[tiab] OR girls[tiab])");
  const fish = translateOvidLine("fish*4.ti,ab.");
  assert.equal(fish.pubmed, "fish*[tiab]");
  assert.deepEqual(kinds(fish), [["close", "fish*4"]]);
  const ear = translateOvidLine("ear*.ti,ab.");
  assert.equal(ear.pubmed, "(ear[tiab] OR ears[tiab])");
  assert.deepEqual(kinds(ear), [["close", "ear*"]]);
});

test("adjN becomes proximity with one fewer word between", () => {
  assert.equal(translateOvidLine("(migraine adj3 attack).ti,ab.").pubmed, '"migraine attack"[tiab:~2]');
  assert.equal(translateOvidLine("(migraine adj1 attack).ti,ab.").pubmed, '"migraine attack"[tiab:~0]');
  // Plain adj: next to each other, in order – a phrase.
  assert.equal(translateOvidLine("(migraine adj attack).ti,ab.").pubmed, '"migraine attack"[tiab]');
  // PubMed can't truncate inside proximity, so the word forms are listed.
  const t = translateOvidLine("(school adj2 age*).ti,ab.");
  assert.equal(t.pubmed, '("school age"[tiab:~1] OR "school ages"[tiab:~1])');
  assert.ok(kinds(t).some(([k, o]) => k === "close" && o === "school adj2 age*"));
  // Alternatives on either side are combined.
  assert.equal(translateOvidLine("(migraine adj2 (attack or episode)).ti,ab.").pubmed, '("migraine attack"[tiab:~1] OR "migraine episode"[tiab:~1])');
});

test("a full keyword line is flattened into one OR list", () => {
  const r = translateOvidLine("(child* or p?ediatric* or boy*1 or (school adj2 age*)).ti,ab.");
  assert.equal(
    r.pubmed,
    '(child*[tiab] OR pediatric*[tiab] OR paediatric*[tiab] OR boy[tiab] OR boys[tiab] OR "school age"[tiab:~1] OR "school ages"[tiab:~1])',
  );
});

test("lines without a field, unsupported lines and errors are reported", () => {
  const nf = translateOvidLine("heart attack");
  assert.equal(nf.pubmed, '"heart attack"[tw]');
  assert.deepEqual(kinds(nf), [["close", "(no field)"]]);
  assert.match(translateOvidLine("limit 5 to english language").error, /Limits/);
  assert.match(translateOvidLine("(migraine or headache.ti,ab.").error, /bracket/);
  assert.match(translateOvidLine("3 and 4", { 3: "a[tiab]" }).error, /Line 4/);
});

test("combination lines use the translated lines they refer to", () => {
  const prev = { 1: '"Child"[Mesh]', 2: "(child*[tiab] OR kid[tiab])", 3: "migrain*[tiab]" };
  assert.equal(translateOvidLine("or/1-2", prev).pubmed, '("Child"[Mesh] OR child*[tiab] OR kid[tiab])');
  assert.equal(translateOvidLine("1 or 2", prev).pubmed, '("Child"[Mesh] OR child*[tiab] OR kid[tiab])');
  assert.equal(translateOvidLine("2 and 3", prev).pubmed, "(child*[tiab] OR kid[tiab]) AND migrain*[tiab]");
  assert.equal(translateOvidLine("3 not 1", prev).pubmed, 'migrain*[tiab] NOT "Child"[Mesh]');
});

test("buildOvidHistory numbers lines and combines concepts", () => {
  const h = buildOvidHistory(
    [
      { concept: "children", headings: [{ heading: "Child" }, { heading: "Adolescent", explode: false }], keywordLine: "child*.ti,ab." },
      { concept: "migraine", headings: [{ heading: "Migraine Disorders" }], keywordLine: "migrain*.ti,ab." },
      { concept: "triptans", headings: [], keywordLine: "triptan*.ti,ab." },
      { concept: "nsaids", headings: [], keywordLine: "nsaid*1.ti,ab." },
    ],
    ["AND", "AND", "OR"],
  );
  assert.deepEqual(
    h.lines.map((l) => l.text),
    ["exp Child/", "Adolescent/", "child*.ti,ab.", "or/1-3", "exp Migraine Disorders/", "migrain*.ti,ab.", "5 or 6", "triptan*.ti,ab.", "nsaid*1.ti,ab.", "8 or 9", "4 and 7 and 10"],
  );
  assert.equal(h.finalLine, 11);
  assert.deepEqual(h.conceptLine, { children: 4, migraine: 7, triptans: 8, nsaids: 9 });

  const t = translateOvidHistory(h.lines);
  assert.equal(
    t.byLine[11],
    '("Child"[Mesh] OR "Adolescent"[Mesh:NoExp] OR child*[tiab]) AND ("Migraine Disorders"[Mesh] OR migrain*[tiab]) AND (triptan*[tiab] OR nsaid[tiab] OR nsaids[tiab])',
  );

  // No final line until every operator is chosen; a single concept needs none.
  assert.equal(buildOvidHistory([{ concept: "a", keywordLine: "a.ti,ab." }, { concept: "b", keywordLine: "b.ti,ab." }], [""]).finalLine, 0);
  assert.equal(buildOvidHistory([{ concept: "a", keywordLine: "a.ti,ab." }]).finalLine, 1);
});

test("terms convert between Ovid and PubMed for stage 3", () => {
  assert.deepEqual(ovidTermToPubmed("p?ediatric*").terms, ["pediatric*", "paediatric*"]);
  assert.deepEqual(ovidTermToPubmed("boy*1").terms, ["boy", "boys"]);
  assert.deepEqual(ovidTermToPubmed("migraine adj3 attack").terms, ['"migraine attack"[tiab:~2]']);
  assert.deepEqual(ovidTermToPubmed("abdominal migrain$").terms, ["abdominal migrain*"]);
  assert.deepEqual(pubmedTermToOvid('"migraine attack"[tiab:~2]').terms, ["migraine adj3 attack"]);
  assert.deepEqual(pubmedTermToOvid('"abdominal migraine"').terms, ["abdominal migraine"]);
  assert.deepEqual(pubmedTermToOvid("asthma[tiab]").terms, ["asthma"]);

  const toPubmed = convertTerms("child*\np?ediatric*\nboy*1", "pubmed");
  assert.equal(toPubmed.text, "child*\npediatric*\npaediatric*\nboy\nboys");
  assert.deepEqual(toPubmed.changed, [
    { from: "p?ediatric*", to: "pediatric*, paediatric*" },
    { from: "boy*1", to: "boy, boys" },
  ]);
  assert.deepEqual(convertTerms("child*\nmigrain*", "ovid").changed, []);
});

test("checkTerm flags syntax from the wrong database", () => {
  assert.deepEqual(checkTerm("migrain*", "pubmed"), []);
  assert.deepEqual(checkTerm('"migraine attack"[tiab:~2]', "pubmed"), []);
  assert.match(checkTerm("boy*", "pubmed").join(), /4 letters/);
  assert.match(checkTerm("wom#n", "pubmed").join(), /one-letter wildcard/);
  assert.match(checkTerm("migrain$", "pubmed").join(), /not \$/);
  assert.match(checkTerm("migraine adj3 attack", "pubmed").join(), /adj is Ovid/);

  assert.deepEqual(checkTerm("p?ediatric*", "ovid"), []);
  assert.deepEqual(checkTerm("migraine adj3 attack*", "ovid"), []);
  assert.match(checkTerm("migraine[tiab]", "ovid").join(), /PubMed/);
  assert.match(checkTerm("*child", "ovid").join(), /first character/);
  assert.match(checkTerm("migraine adj attack", "ovid").join(), /adj2 or adj3/);
});

test("PubMed blocks respect the Explode choice", () => {
  assert.equal(meshTerm("Adolescent", { explode: false }), '"Adolescent"[Mesh:NoExp]');
  assert.equal(
    buildBlock({ concept: "children", meshHeadings: [{ heading: "Child" }, { heading: "Adolescent", explode: false }] }),
    '("Child"[Mesh] OR "Adolescent"[Mesh:NoExp] OR children[tiab])',
  );
});
