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
  if (/\[[a-z ]+\]$/i.test(t)) return t;
  const bare = t.replace(/^"(.*)"$/, "$1");
  return /\s/.test(bare) ? `"${bare}"[tiab]` : `${bare}[tiab]`;
}

export function meshTerm(heading) {
  const h = String(heading || "").trim();
  return h ? `"${h}"[Mesh]` : "";
}

// One concept block: MeSH headings and keywords joined with OR, in brackets.
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
  meshHeadings.forEach((h) => add(meshTerm(h)));
  [concept, ...synonyms].forEach((t) => add(keywordTerm(t)));
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

export const OPERATORS = ["AND", "OR", "NOT"];

// Join blocks with the operators the student chose. Returns "" until every gap has an operator.
export function combineBlocks(blocks, operators) {
  const filled = blocks.map((b) => String(b || "").trim()).filter(Boolean);
  if (filled.length === 0) return "";
  let out = filled[0];
  for (let i = 1; i < filled.length; i += 1) {
    const op = operators[i - 1];
    if (!OPERATORS.includes(op)) return "";
    out += ` ${op} ${filled[i]}`;
  }
  return out;
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
