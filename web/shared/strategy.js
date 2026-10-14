// Helpers for turning a student's concepts, synonyms and MeSH headings into PubMed search syntax.

// Split free text (one term per line, or semicolon separated) into unique terms.
// Commas are kept because inverted terms like "Diabetes Mellitus, Type 2" contain them.
export function parseTerms(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || "").split(/[\n;]+/)) {
    const term = raw.trim().replace(/\s+/g, " ");
    const key = term.toLowerCase();
    if (term && !seen.has(key)) {
      seen.add(key);
      out.push(term);
    }
  }
  return out;
}

// A keyword searched in titles and abstracts. Phrases are quoted; existing field tags are kept.
export function keywordTerm(term) {
  const t = String(term || "").trim();
  if (!t) return "";
  if (/\[[a-z /]+(:[a-z~0-9]+)?\]$/i.test(t)) return t;
  const bare = t.replace(/^"(.*)"$/, "$1");
  return /\s/.test(bare) ? `"${bare}"[tiab]` : `${bare}[tiab]`;
}

// A MeSH heading. PubMed explodes headings by default; `explode: false` adds :NoExp.
export function meshTerm(heading, { explode = true } = {}) {
  const h = String(heading || "").trim();
  return h ? `"${h}"[Mesh${explode ? "" : ":NoExp"}]` : "";
}

// Leaves out single words already found by a truncated term in the list: "migraine" when
// "migrain*" is there. Keeps the search shorter without changing what it finds.
export function dropCovered(terms) {
  const stems = terms.map((t) => String(t || "").trim().match(/^([a-z0-9-]+)[*$]$/i)?.[1]?.toLowerCase()).filter(Boolean);
  return terms.filter((t) => {
    const w = String(t || "").trim().toLowerCase();
    return !/^[a-z0-9-]+$/.test(w) || !stems.some((stem) => w.startsWith(stem));
  });
}

// One concept block: MeSH headings and keywords joined with OR, in brackets.
// `meshHeadings` holds heading names or { heading, explode } objects.
export function buildBlock({ concept = "", synonyms = [], meshHeadings = [] } = {}) {
  const parts = [];
  const seen = new Set();
  const add = (p) => {
    const key = p.toLowerCase();
    if (p && !seen.has(key)) {
      seen.add(key);
      parts.push(p);
    }
  };
  meshHeadings.forEach((h) => add(typeof h === "string" ? meshTerm(h) : meshTerm(h?.heading, { explode: h?.explode !== false })));
  dropCovered([concept, ...synonyms]).forEach((t) => add(keywordTerm(t)));
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

export const OPERATORS = ["AND", "OR", "NOT"];

// Join blocks with the operators the student chose. Returns "" until every gap has an operator.
// Blocks joined by OR are alternatives for the same idea (e.g. triptans OR NSAIDs), so they are
// bracketed together first: #1 AND #2 OR #3 becomes #1 AND (#2 OR #3). PubMed would otherwise
// read it left to right as (#1 AND #2) OR #3.
export function combineBlocks(blocks, operators) {
  const filled = blocks.map((b) => String(b || "").trim()).filter(Boolean);
  if (filled.length === 0) return "";
  const groups = [[filled[0]]];
  const joins = [];
  for (let i = 1; i < filled.length; i += 1) {
    const op = operators[i - 1];
    if (!OPERATORS.includes(op)) return "";
    if (op === "OR") groups.at(-1).push(filled[i]);
    else {
      joins.push(op);
      groups.push([filled[i]]);
    }
  }
  const text = groups.map((g) => (g.length === 1 ? g[0] : `(${g.join(" OR ")})`));
  return text.reduce((out, g, i) => `${out} ${joins[i - 1]} ${g}`);
}

// Check that brackets and quotes balance, so students get a clear message before searching.
export function checkSyntax(query) {
  const problems = [];
  let depth = 0;
  let inQuote = false;
  for (const ch of String(query || "")) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "(") depth += 1;
    else if (!inQuote && ch === ")") {
      depth -= 1;
      if (depth < 0) break;
    }
  }
  if (inQuote) problems.push("There is an unmatched quotation mark.");
  if (depth > 0) problems.push("There are more opening brackets than closing brackets.");
  if (depth < 0) problems.push("A closing bracket appears before its opening bracket.");
  if (/\b(and|or|not)\b/.test(String(query || "").replace(/"[^"]*"/g, ""))) {
    problems.push("Boolean operators should be in capitals (AND, OR, NOT) so PubMed recognises them.");
  }
  return problems;
}
