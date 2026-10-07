import { test } from "node:test";
import assert from "node:assert/strict";
import { countPubMed, searchMesh } from "../web/shared/ncbi.js";

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => match[1] };
  };
  impl.calls = calls;
  return impl;
}

test("searchMesh returns descriptors with scope notes and tree numbers", async () => {
  const fetchImpl = fakeFetch({
    "esearch.fcgi": { esearchresult: { idlist: ["68009203", "62000001"] } },
    "esummary.fcgi": {
      result: {
        uids: ["68009203", "62000001"],
        68009203: {
          ds_meshui: "D009203",
          ds_meshterms: ["Myocardial Infarction", "Heart Attack", "Myocardial Infarct"],
          ds_scopenote: "NECROSIS of the MYOCARDIUM.",
          ds_idxlinks: [{ treenum: "C14.280.647.500" }],
        },
        62000001: { ds_meshui: "C000001", ds_meshterms: ["A supplementary concept"] },
      },
    },
  });
  const results = await searchMesh("heart attack", { fetchImpl });
  assert.equal(results.length, 1);
  assert.equal(results[0].heading, "Myocardial Infarction");
  assert.deepEqual(results[0].entryTerms, ["Heart Attack", "Myocardial Infarct"]);
  assert.deepEqual(results[0].treeNumbers, ["C14.280.647.500"]);
  assert.match(fetchImpl.calls[0], /db=mesh/);
  assert.match(fetchImpl.calls[0], /term=heart\+attack/);
});

test("searchMesh returns nothing for an empty term or no matches", async () => {
  assert.deepEqual(await searchMesh("  "), []);
  const fetchImpl = fakeFetch({ "esearch.fcgi": { esearchresult: { idlist: [] } } });
  assert.deepEqual(await searchMesh("zzzz", { fetchImpl }), []);
});

test("countPubMed returns the count, translation and warnings", async () => {
  const fetchImpl = fakeFetch({
    "esearch.fcgi": {
      esearchresult: { count: "1234", querytranslation: "asthma[MeSH Terms]", warninglist: { phrasesignored: ["the"] } },
    },
  });
  const r = await countPubMed("asthma[mesh]", { fetchImpl, apiKey: "k" });
  assert.equal(r.count, 1234);
  assert.equal(r.queryTranslation, "asthma[MeSH Terms]");
  assert.deepEqual(r.warnings, ["phrasesignored: the"]);
  assert.match(r.url, /pubmed\.ncbi\.nlm\.nih\.gov\/\?term=asthma/);
  assert.match(fetchImpl.calls[0], /api_key=k/);
});
