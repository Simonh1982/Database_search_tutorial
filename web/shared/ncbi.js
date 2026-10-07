// Look-ups against the free NCBI E-utilities service.
// Shared by the browser (offline demo) and the Codespace server.
// Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "database_search_tutorial";

function eutilsUrl(path, params, apiKey) {
  const search = new URLSearchParams({ ...params, retmode: "json", tool: TOOL });
  if (apiKey) search.set("api_key", apiKey);
  return `${EUTILS}/${path}?${search}`;
}

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`NCBI returned ${res.status}`);
  return res.json();
}

// Find MeSH descriptors (subject headings) matching a word or phrase.
// E-utilities also matches entry terms, so "heart attack" finds "Myocardial Infarction".
export async function searchMesh(term, { fetchImpl = fetch, apiKey = "", limit = 8 } = {}) {
  const query = String(term || "").trim();
  if (!query) return [];

  const found = await getJson(eutilsUrl("esearch.fcgi", { db: "mesh", term: query, retmax: String(limit) }, apiKey), fetchImpl);
  const ids = found?.esearchresult?.idlist || [];
  if (ids.length === 0) return [];

  const summary = await getJson(eutilsUrl("esummary.fcgi", { db: "mesh", id: ids.join(",") }, apiKey), fetchImpl);
  const result = summary?.result || {};

  return (result.uids || ids)
    .map((uid) => result[uid])
    .filter((r) => r && typeof r.ds_meshui === "string" && r.ds_meshui.startsWith("D"))
    .map((r) => {
      const terms = Array.isArray(r.ds_meshterms) ? r.ds_meshterms : [];
      return {
        ui: r.ds_meshui,
        heading: terms[0] || "",
        entryTerms: terms.slice(1, 13),
        scopeNote: (r.ds_scopenote || "").trim(),
        treeNumbers: (Array.isArray(r.ds_idxlinks) ? r.ds_idxlinks : []).map((l) => l?.treenum).filter(Boolean),
        url: `https://meshb.nlm.nih.gov/record/ui?ui=${encodeURIComponent(r.ds_meshui)}`,
      };
    })
    .filter((r) => r.heading);
}

// Count how many PubMed records a search strategy retrieves.
export async function countPubMed(query, { fetchImpl = fetch, apiKey = "" } = {}) {
  const term = String(query || "").trim();
  if (!term) throw new Error("The search is empty.");

  const data = await getJson(eutilsUrl("esearch.fcgi", { db: "pubmed", term, retmax: "0" }, apiKey), fetchImpl);
  const r = data?.esearchresult;
  if (!r) throw new Error("Unexpected response from PubMed.");
  if (r.ERROR) throw new Error(r.ERROR);

  const warnings = [];
  for (const [kind, items] of Object.entries(r.warninglist || {})) {
    if (Array.isArray(items) && items.length) warnings.push(`${kind}: ${items.join("; ")}`);
  }
  for (const [kind, items] of Object.entries(r.errorlist || {})) {
    if (Array.isArray(items) && items.length) warnings.push(`${kind}: ${items.join("; ")}`);
  }

  return {
    count: Number.parseInt(r.count, 10) || 0,
    queryTranslation: r.querytranslation || "",
    warnings,
    url: pubmedUrl(term),
  };
}

export function pubmedUrl(query) {
  return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(query)}`;
}
