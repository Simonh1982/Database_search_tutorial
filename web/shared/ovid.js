// Ovid MEDLINE syntax: building Ovid search lines, translating them into PubMed syntax (so they can
// be counted with PubMed's free API), converting a student's terms between the two databases, and
// checking terms as they're typed. Shared by the browser and the server, so no DOM or Node APIs.
//
// Each translation reports what changed, so students can see where PubMed differs:
//   same   – PubMed has an exact equivalent
//   listed – Ovid's symbol has no PubMed equivalent, so the word forms are listed instead
//   close  – the PubMed version may find slightly different records
//   check  – we couldn't translate it; the student should look at it

export const DATABASES = {
  ovid: { name: "Ovid MEDLINE", short: "Ovid" },
  pubmed: { name: "PubMed", short: "PubMed" },
};

// PubMed needs at least this many characters before the first * in a term.
const PUBMED_MIN_STEM = 4;
// Upper limit on the forms one term may be listed as, so a translation stays readable.
const MAX_FORMS = 12;

const WILDCARD = /[#?]/;
const VOWELS = ["a", "e", "i", "o", "u"];
// Fragments of common UK spellings with "ae" or "oe", used to pick the right one for p?ediatric.
const UK_AE_OE = ["paed", "haem", "naem", "caem", "gaem", "aetiol", "gynaec", "caes", "aesth", "anaes", "oesoph", "oestr", "oedem", "foet", "rrhoe", "pnoe", "coel", "manoeuv"];

// ---------- Ovid search lines ----------

// A subject heading as an Ovid line: "exp Child/" or "Adolescent/".
export function ovidHeading(heading, explode = true) {
  const h = String(heading || "").trim();
  return h ? `${explode ? "exp " : ""}${h}/` : "";
}

// Keywords as one Ovid line searched in titles and abstracts:
// "(child* or p?ediatric* or (school adj2 age*)).ti,ab."
export function ovidKeywordLine(terms) {
  const seen = new Set();
  const parts = [];
  for (const raw of terms) {
    const t = String(raw || "").trim();
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    // A term with its own operators is bracketed so it stays together.
    parts.push(/\s(or|and|not|adj\d*)\s/i.test(` ${t} `) && !/^\(.*\)$/.test(t) ? `(${t})` : t);
  }
  if (parts.length === 0) return "";
  return parts.length === 1 && !/^\(/.test(parts[0]) ? `${parts[0]}.ti,ab.` : `(${parts.join(" or ")}).ti,ab.`;
}

// Joins line numbers with or: [3] → "3", [5, 6] → "5 or 6", [1, 2, 3] → "or/1-3".
function orLine(numbers) {
  if (numbers.length === 1) return String(numbers[0]);
  const consecutive = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  if (numbers.length > 2 && consecutive) return `or/${numbers[0]}-${numbers.at(-1)}`;
  return numbers.join(" or ");
}

// Builds a numbered Ovid search history.
//   concepts:  [{ concept, headings: [{ heading, explode }], keywordLine }]
//   operators: "AND" | "OR" | "NOT" between concepts (as in stage 5)
// Returns { lines: [{ n, text, kind, concept }], conceptLine: { concept: n }, finalLine: n | 0 }.
// Concepts joined by OR are alternatives, so they get their own "or" line first (as combineBlocks).
export function buildOvidHistory(concepts, operators = []) {
  const lines = [];
  const conceptLine = {};
  const add = (text, kind, concept = "") => {
    lines.push({ n: lines.length + 1, text, kind, concept });
    return lines.length;
  };

  const filled = [];
  for (const c of concepts) {
    const own = [];
    for (const h of c.headings || []) {
      const text = ovidHeading(h.heading, h.explode !== false);
      if (text) own.push(add(text, "heading", c.concept));
    }
    if (String(c.keywordLine || "").trim()) own.push(add(c.keywordLine.trim(), "keywords", c.concept));
    if (own.length === 0) continue;
    conceptLine[c.concept] = own.length === 1 ? own[0] : add(orLine(own), "combine", c.concept);
    filled.push({ concept: c.concept, n: conceptLine[c.concept], op: operators[concepts.indexOf(c) - 1] });
  }
  if (filled.length < 2) return { lines, conceptLine, finalLine: filled[0]?.n || 0 };

  // Group concepts joined by OR, then join the groups with AND / NOT.
  const groups = [[filled[0].n]];
  const joins = [];
  for (const f of filled.slice(1)) {
    const op = String(f.op || "").toUpperCase();
    if (!["AND", "OR", "NOT"].includes(op)) return { lines, conceptLine, finalLine: 0 };
    if (op === "OR") groups.at(-1).push(f.n);
    else {
      joins.push(op.toLowerCase());
      groups.push([f.n]);
    }
  }
  const refs = groups.map((g) => (g.length === 1 ? g[0] : add(orLine(g), "combine")));
  if (refs.length === 1) return { lines, conceptLine, finalLine: refs[0] };
  const finalText = refs.reduce((out, r, i) => `${out} ${joins[i - 1]} ${r}`);
  return { lines, conceptLine, finalLine: add(String(finalText), "final") };
}

// ---------- Parsing Ovid syntax ----------

const FIELD_SUFFIX = /^\.([a-z]{2,3}(?:,[a-z]{2,3})*)\.(?=$|[\s)])/i;
const OPERATOR = /^(or|and|not|adj\d*)$/i;

function tokenise(text) {
  const tokens = [];
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === "(" || ch === ")") {
      tokens.push({ type: ch });
      i += 1;
    } else if (ch === '"') {
      const end = s.indexOf('"', i + 1);
      const inner = s.slice(i + 1, end === -1 ? s.length : end);
      tokens.push({ type: "quoted", value: inner.trim() });
      i = end === -1 ? s.length : end + 1;
    } else if (ch === "/") {
      // A subject heading ends with "/" and may have subheadings: "Migraine Disorders/dt,th".
      const m = s.slice(i + 1).match(/^([a-z]{2}(?:,\s*[a-z]{2})*)?(?=$|[\s)])/i);
      tokens.push({ type: "slash", subheadings: m?.[1] || "" });
      i += 1 + (m?.[1]?.length || 0);
    } else {
      const field = s.slice(i).match(FIELD_SUFFIX);
      if (field && tokens.length) {
        tokens.push({ type: "field", value: field[1].toLowerCase() });
        i += field[0].length;
        continue;
      }
      let j = i;
      while (j < s.length && !/[\s()"/]/.test(s[j])) {
        if (s[j] === "." && FIELD_SUFFIX.test(s.slice(j))) break;
        j += 1;
      }
      if (j === i) j = i + 1;
      const word = s.slice(i, j);
      tokens.push(OPERATOR.test(word) ? { type: "op", value: word.toLowerCase() } : { type: "word", value: word });
      i = j;
    }
  }
  return tokens;
}

// Recursive-descent parser. Operator precedence: adj, then not, then and, then or.
// Node types: { type: "phrase", words }, { type: "heading", heading, explode, major, subheadings },
// { type: "op", op, left, right }, { type: "adj", n, left, right }, { type: "field", fields, node }.
function parse(text) {
  const tokens = tokenise(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function primary() {
    const t = peek();
    if (!t) throw new Error("The line ends too early.");
    let node;
    if (t.type === "(") {
      next();
      node = orExpr();
      if (peek()?.type !== ")") throw new Error("A bracket isn't closed.");
      next();
    } else if (t.type === "quoted") {
      next();
      node = { type: "phrase", words: t.value.split(/\s+/).filter(Boolean) };
    } else if (t.type === "word") {
      const words = [];
      while (peek()?.type === "word") words.push(next().value);
      if (peek()?.type === "slash") {
        const { subheadings } = next();
        let explode = false;
        let major = false;
        if (words[0]?.toLowerCase() === "exp") {
          explode = true;
          words.shift();
        }
        if (words[0]?.startsWith("*")) {
          major = true;
          words[0] = words[0].slice(1);
          if (!words[0]) words.shift();
        }
        node = { type: "heading", heading: words.join(" "), explode, major, subheadings };
      } else {
        node = { type: "phrase", words };
      }
    } else {
      throw new Error(`Unexpected “${t.value || t.type}”.`);
    }
    while (peek()?.type === "field") node = { type: "field", fields: next().value.split(","), node };
    return node;
  }

  function adjExpr() {
    let node = primary();
    while (peek()?.type === "op" && peek().value.startsWith("adj")) {
      const n = Number.parseInt(next().value.slice(3), 10);
      node = { type: "adj", n: Number.isFinite(n) ? n : 0, left: node, right: primary() };
    }
    return node;
  }
  const binary = (op, lower) => () => {
    let node = lower();
    while (peek()?.type === "op" && peek().value === op) {
      next();
      node = { type: "op", op, left: node, right: lower() };
    }
    return node;
  };
  const notExpr = binary("not", adjExpr);
  const andExpr = binary("and", notExpr);
  const orExpr = binary("or", andExpr);

  const tree = orExpr();
  if (pos < tokens.length) throw new Error(`Unexpected “${tokens[pos].value || tokens[pos].type}”.`);
  return tree;
}

// ---------- Translating words ----------

const letters = (s) => s.replace(/[^a-z0-9]/gi, "");

// The letters that can fill a one-letter wildcard in the middle of a word, chosen from common
// UK/US and other spelling patterns. `known` is false when we had to fall back to every vowel.
function wildcardLetters(before, after, symbol) {
  const prev = before.slice(-1).toLowerCase();
  const nxt = after.slice(0, 1).toLowerCase();
  const optional = symbol === "?";
  // paediatric/pediatric, anaemia/anemia, diarrhoea/diarrhea
  if (nxt === "e" && !VOWELS.includes(prev)) {
    const word = (l) => `${before}${l}${after}`.toLowerCase();
    const uk = ["a", "o"].filter((l) => UK_AE_OE.some((f) => word(l).includes(f)));
    const letters = uk.length ? uk : ["a", "o"];
    return { options: optional ? ["", ...letters] : letters, known: true };
  }
  // colour/color, behaviour/behavior
  if (prev === "o" && nxt === "r") return { options: optional ? ["", "u"] : ["u"], known: true };
  // randomised/randomized, analyse/analyze
  if ((prev === "i" || prev === "y") && ["e", "a", "i"].includes(nxt)) return { options: ["s", "z"], known: true };
  // travelled/traveled: a doubled consonant
  if (optional && prev && !VOWELS.includes(prev) && VOWELS.includes(nxt)) return { options: ["", prev], known: true };
  return { options: optional ? ["", ...VOWELS] : VOWELS, known: false };
}

// Expands one Ovid word (no spaces) into PubMed word forms.
// Returns { forms: ["paediatric*", "pediatric*"], changes: [...] }.
function translateWord(word, { inProximity = false } = {}) {
  const changes = [];
  let w = word;
  if (/^[*$#?]/.test(w)) {
    changes.push({ kind: "check", ovid: word, pubmed: w.replace(/^[*$#?]+/, ""), why: "Truncation and wildcards can't be the first character, so the symbol was removed." });
    w = w.replace(/^[*$#?]+/, "");
  }

  // Trailing truncation: * or $, optionally limited (*1, $2).
  let trunc = null;
  const tm = w.match(/[*$](\d*)$/);
  if (tm) {
    trunc = { limit: tm[1] ? Number(tm[1]) : 0, symbol: tm[0] };
    w = w.slice(0, -tm[0].length);
  }
  // Ovid allows truncation inside a word too ("wom*n" style). PubMed allows * inside a word.
  w = w.replace(/\$/g, "*");

  // Internal one-letter wildcards (# exactly one, ? one or none).
  let stems = [w];
  let listedReason = "";
  if (WILDCARD.test(w)) {
    const firstWildcard = w.search(WILDCARD);
    let allKnown = true;
    let expanded = [""];
    for (let i = 0; i < w.length; i += 1) {
      const ch = w[i];
      if (ch !== "#" && ch !== "?") {
        expanded = expanded.map((s) => s + ch);
        continue;
      }
      const { options, known } = wildcardLetters(w.slice(0, i), w.slice(i + 1), ch);
      allKnown &&= known;
      expanded = expanded.flatMap((s) => options.map((o) => s + o));
    }
    if (!allKnown && firstWildcard >= PUBMED_MIN_STEM && !inProximity) {
      stems = [w.replace(/[#?]/g, "*")];
      changes.push({
        kind: "close",
        ovid: word,
        pubmed: stems[0] + (trunc ? "*" : ""),
        why: "PubMed has no one-letter wildcard, so * was used inside the word. It matches any number of letters, so it may find a few extra words.",
      });
    } else if (expanded.length > MAX_FORMS) {
      stems = [w.replace(/[#?]/g, "")];
      changes.push({ kind: "check", ovid: word, pubmed: stems[0], why: "This word has too many possible spellings to list. Please list the spellings you want in stage 3." });
    } else {
      stems = [...new Set(expanded)];
      listedReason = allKnown
        ? "PubMed has no one-letter wildcard, and a * inside a word needs 4 letters before it, so the spellings are listed."
        : "PubMed has no one-letter wildcard, so every vowel was tried. Words that don't exist simply find nothing; you could list the real spellings yourself.";
    }
  }

  // Apply the trailing truncation to every stem.
  let forms = stems;
  if (trunc) {
    const shortStem = stems.some((s) => letters(s.split("*")[0]).length < PUBMED_MIN_STEM);
    if (trunc.limit === 1 || inProximity || shortStem) {
      // PubMed can't do limited truncation, can't truncate in proximity, and needs 4 letters
      // before *, so list the singular and plural instead.
      forms = stems.flatMap((s) => [s, `${s}s`]);
      const why = inProximity
        ? "PubMed can't use * in a proximity search, so the word and its plural are listed. Other endings aren't included."
        : trunc.limit === 1
          ? `PubMed has no limited truncation, so the word and its plural are listed. Ovid's ${trunc.symbol} also allows any other single letter.`
          : `PubMed needs ${PUBMED_MIN_STEM} letters before *, so the word and its plural are listed. Other endings aren't included.`;
      changes.push({ kind: !inProximity && trunc.limit === 1 ? "listed" : "close", ovid: word, pubmed: forms.join(" OR "), why });
      listedReason = "";
    } else {
      forms = stems.map((s) => `${s}*`);
      if (trunc.limit > 1) {
        changes.push({ kind: "close", ovid: word, pubmed: forms.join(" OR "), why: "PubMed has no limited truncation, so unlimited truncation (*) was used. It may find longer words too." });
      } else if (trunc.symbol === "$") {
        changes.push({ kind: "same", ovid: "$", pubmed: "*", why: "" });
      }
    }
  }
  if (listedReason) changes.push({ kind: "listed", ovid: word, pubmed: forms.join(" OR "), why: listedReason });
  return { forms, changes };
}

// Every combination of the forms of each word, joined into phrases (capped at MAX_FORMS).
function phraseForms(words, options) {
  let out = [""];
  const changes = [];
  for (const word of words) {
    const t = translateWord(word, options);
    changes.push(...t.changes);
    out = out.flatMap((p) => t.forms.map((f) => (p ? `${p} ${f}` : f)));
  }
  const capped = out.length > MAX_FORMS;
  if (capped) {
    changes.push({ kind: "check", ovid: words.join(" "), pubmed: out.slice(0, MAX_FORMS).join(" OR "), why: `Only the first ${MAX_FORMS} combinations of word forms are searched.` });
  }
  return { forms: [...new Set(out.slice(0, MAX_FORMS))], changes };
}

// ---------- Translating a whole line ----------

const FIELDS = {
  ti: { tag: "ti", kind: "same" },
  ab: { tag: "tiab", kind: "close", why: "PubMed can't search abstracts alone, so titles and abstracts are searched." },
  tw: { tag: "tiab", kind: "same" },
  mp: { tag: "tw", kind: "close", why: "Ovid's .mp. searches several fields; PubMed's [tw] (text words) is the nearest match." },
  kf: { tag: "ot", kind: "same" },
  kw: { tag: "ot", kind: "same" },
};

function fieldTag(fields, changes) {
  const set = [...new Set(fields.map((f) => f.toLowerCase()))];
  if (set.every((f) => ["ti", "ab", "tw"].includes(f)) && (set.includes("ab") || set.includes("tw")) && (set.includes("ti") || set.includes("tw"))) {
    changes.push({ kind: "same", ovid: `.${set.join(",")}.`, pubmed: "[tiab]", why: "" });
    return "tiab";
  }
  if (set.length === 1 && FIELDS[set[0]]) {
    const f = FIELDS[set[0]];
    changes.push({ kind: f.kind, ovid: `.${set[0]}.`, pubmed: `[${f.tag}]`, why: f.why || "" });
    return f.tag;
  }
  changes.push({
    kind: "check",
    ovid: `.${set.join(",")}.`,
    pubmed: "[tiab]",
    why: "This combination of fields can't be translated exactly, so titles and abstracts are searched.",
  });
  return "tiab";
}

function tagged(form, tag) {
  return /\s/.test(form) ? `"${form}"[${tag}]` : `${form}[${tag}]`;
}

const orJoin = (parts) => (parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`);

// Flattens one side of an adj into its alternative phrases: (age* or aged) → [["age*"], ["aged"]].
function alternatives(node) {
  if (node.type === "phrase") return [node.words];
  if (node.type === "op" && node.op === "or") return [...alternatives(node.left), ...alternatives(node.right)];
  if (node.type === "field") return alternatives(node.node);
  return null;
}

function translateNode(node, ctx) {
  switch (node.type) {
    case "field": {
      const tag = fieldTag(node.fields, ctx.changes);
      return translateNode(node.node, { ...ctx, tag, explicitField: true });
    }
    case "phrase": {
      // A line number inside a combination line ("4 and 7") stands for that line's search.
      if (ctx.refs && node.words.length === 1 && /^\d+$/.test(node.words[0])) {
        const ref = ctx.refs[node.words[0]];
        if (!ref) throw new Error(`Line ${node.words[0]} doesn't exist yet, or couldn't be translated.`);
        return ref;
      }
      if (!ctx.explicitField) {
        ctx.changes.push({ kind: "close", ovid: "(no field)", pubmed: "[tw]", why: "Without a field, Ovid searches several fields (.mp.); PubMed's [tw] is the nearest match." });
      }
      const { forms, changes } = phraseForms(node.words, {});
      ctx.changes.push(...changes);
      return orJoin(forms.map((f) => tagged(f, ctx.tag)));
    }
    case "heading": {
      if (node.subheadings) {
        ctx.changes.push({
          kind: "check",
          ovid: `/${node.subheadings}`,
          pubmed: "",
          why: "Subheadings aren't translated yet, so the whole heading is searched.",
        });
      }
      const tag = `${node.major ? "Majr" : "Mesh"}${node.explode ? "" : ":NoExp"}`;
      ctx.changes.push({
        kind: "same",
        ovid: `${node.explode ? "exp " : ""}${node.major ? "*" : ""}Heading/`,
        pubmed: `"Heading"[${tag}]`,
        why: "",
      });
      return `"${node.heading}"[${tag}]`;
    }
    case "op": {
      if (node.op === "not") return `(${translateNode(node.left, ctx)} NOT ${translateNode(node.right, ctx)})`;
      // Flatten chains of the same operator: (a OR b OR c), not ((a OR b) OR c).
      const operands = [];
      const collect = (n) => (n.type === "op" && n.op === node.op ? (collect(n.left), collect(n.right)) : operands.push(n));
      collect(node);
      const parts = operands.flatMap((n) => topLevelParts(translateNode(n, ctx), node.op.toUpperCase()));
      return `(${parts.join(` ${node.op.toUpperCase()} `)})`;
    }
    case "adj": {
      const left = alternatives(node.left);
      const right = alternatives(node.right);
      const tag = ctx.tag === "ti" ? "ti" : "tiab";
      if (!left || !right) {
        ctx.changes.push({ kind: "check", ovid: "adj", pubmed: "AND", why: "This proximity search is too complex to translate, so AND was used instead." });
        return `(${translateNode(node.left, ctx)} AND ${translateNode(node.right, ctx)})`;
      }
      const side = (alts) => alts.flatMap((words) => phraseForms(words, { inProximity: true }).forms);
      const changes = [];
      for (const words of [...left, ...right]) changes.push(...phraseForms(words, { inProximity: true }).changes);
      const combos = side(left).flatMap((l) => side(right).map((r) => `${l} ${r}`));
      const ovidText = `${left.map((w) => w.join(" ")).join(" or ")} adj${node.n || ""} ${right.map((w) => w.join(" ")).join(" or ")}`;
      if (combos.length > MAX_FORMS) {
        ctx.changes.push({
          kind: "check",
          ovid: ovidText,
          pubmed: "AND",
          why: "Too many word combinations to search by proximity, so the words are joined with AND. This finds more records than Ovid.",
        });
        return `(${orJoin(side(left).map((f) => tagged(f, tag)))} AND ${orJoin(side(right).map((f) => tagged(f, tag)))})`;
      }
      ctx.changes.push(...changes);
      if (node.n === 0) {
        // Plain adj: next to each other, in the order typed – a phrase.
        ctx.changes.push({ kind: "same", ovid: ovidText, pubmed: "a phrase in quotes", why: "" });
        return orJoin(combos.map((c) => `"${c}"[${tag}]`));
      }
      const gap = node.n - 1;
      const pubmed = orJoin(combos.map((c) => `"${c}"[${tag}:~${gap}]`));
      const truncated = changes.length > 0;
      ctx.changes.push({
        kind: truncated || ctx.tag !== tag ? "close" : "same",
        ovid: ovidText,
        pubmed,
        why: `adj${node.n} allows up to ${gap} word${gap === 1 ? "" : "s"} between, which is ~${gap} in PubMed.${truncated ? " PubMed can't use * in a proximity search, so the word forms are listed." : ""}${ctx.tag !== tag ? " PubMed proximity only works in titles and abstracts." : ""}`,
      });
      return pubmed;
    }
    default:
      throw new Error("Unknown search.");
  }
}

// Combination lines refer to earlier lines: "4 and 7 and 10", "or/1-3", "(5 or 6) not 8".
function combinationRefs(text) {
  const t = String(text).trim();
  const slash = t.match(/^(or|and)\/\s*([\d,\s-]+)$/i);
  if (slash) {
    const nums = [];
    for (const part of slash[2].split(",")) {
      const [a, b] = part.split("-").map((x) => Number.parseInt(x, 10));
      if (!Number.isFinite(a)) return null;
      for (let n = a; n <= (Number.isFinite(b) ? b : a); n += 1) nums.push(n);
    }
    return { expression: nums.join(` ${slash[1].toLowerCase()} `) };
  }
  return /^[\d\s()]+((or|and|not)[\d\s()]+)+$/i.test(t) || /^\d+$/.test(t) ? { expression: t } : null;
}

// Translates one Ovid line. `previous` maps earlier line numbers to their PubMed translations.
// Returns { pubmed, changes, error }.
export function translateOvidLine(text, previous = {}) {
  const changes = [];
  const line = String(text || "").trim();
  if (!line) return { pubmed: "", changes, error: "" };

  const combo = combinationRefs(line);
  if (combo) {
    try {
      const pubmed = translateNode(parse(combo.expression), { tag: "tw", changes, refs: previous, explicitField: true });
      return { pubmed: stripOuter(pubmed), changes, error: "" };
    } catch (err) {
      return { pubmed: "", changes, error: err.message };
    }
  }
  if (/^(limit|remove duplicates)\b/i.test(line) || /\/freq=/i.test(line) || /\.fs\./i.test(line)) {
    return { pubmed: "", changes, error: "Limits, frequency searches and floating subheadings aren't translated for PubMed yet." };
  }

  try {
    const pubmed = translateNode(parse(line), { tag: "tw", changes, explicitField: false });
    return { pubmed, changes: dedupeChanges(changes), error: "" };
  } catch (err) {
    return { pubmed: "", changes, error: `This line couldn't be translated: ${err.message}` };
  }
}

// Splits "(a OR b)" into ["a", "b"] when OR is its only top-level operator, so nested OR groups
// can be merged into the surrounding list.
function topLevelParts(text, op) {
  const m = text.match(/^\((.*)\)$/s);
  if (!m || !balanced(m[1])) return [text];
  const parts = [];
  let depth = 0;
  let start = 0;
  let quoted = false;
  const inner = m[1];
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && inner.startsWith(` ${op} `, i)) {
      parts.push(inner.slice(start, i));
      start = i + op.length + 2;
    } else if (depth === 0 && /^ (AND|OR|NOT) /.test(inner.slice(i, i + 5)) && !inner.startsWith(` ${op} `, i)) {
      return [text];
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

// A final AND/NOT combination doesn't need outer brackets; an OR list keeps them (like buildBlock).
function stripOuter(text) {
  const m = text.match(/^\((.*)\)$/s);
  return m && balanced(m[1]) && topLevelParts(text, "OR").length === 1 ? m[1] : text;
}

function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function dedupeChanges(changes) {
  const seen = new Set();
  return changes.filter((c) => {
    const k = `${c.kind}|${c.ovid}|${c.pubmed}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Translates a whole search history. Returns one entry per line plus the final PubMed search.
export function translateOvidHistory(lines) {
  const previous = {};
  const out = lines.map((l) => {
    const t = translateOvidLine(l.text, previous);
    if (t.pubmed) previous[l.n] = t.pubmed;
    return { ...l, ...t };
  });
  return { lines: out, byLine: previous };
}

// ---------- Converting a student's stage 3 terms ----------

// Ovid term → PubMed terms as a student would type them in stage 3 (no [tiab]; the app adds it).
export function ovidTermToPubmed(term) {
  const t = String(term || "").trim();
  if (!t) return { terms: [], changes: [] };
  try {
    const tree = parse(t);
    const changes = [];
    const out = [];
    const walk = (node) => {
      if (node.type === "field") return walk(node.node);
      if (node.type === "op" && node.op === "or") {
        walk(node.left);
        walk(node.right);
        return;
      }
      if (node.type === "phrase") {
        const r = phraseForms(node.words, {});
        changes.push(...r.changes);
        out.push(...r.forms);
        return;
      }
      if (node.type === "adj") {
        const c = [];
        const pubmed = translateNode(node, { tag: "tiab", changes: c });
        changes.push(...c);
        out.push(...pubmed.replace(/^\((.*)\)$/s, "$1").split(" OR "));
        return;
      }
      // Anything else (headings, AND, NOT) is kept as typed for the student to check.
      changes.push({ kind: "check", ovid: t, pubmed: t, why: "This term couldn't be converted automatically." });
      out.push(t);
    };
    walk(tree);
    return { terms: [...new Set(out)], changes: dedupeChanges(changes).filter((c) => c.kind !== "same") };
  } catch {
    return { terms: [t], changes: [{ kind: "check", ovid: t, pubmed: t, why: "This term couldn't be converted automatically." }] };
  }
}

// PubMed term → Ovid term: "migraine attack"[tiab:~2] → migraine adj3 attack, "abdominal migraine" → abdominal migraine.
export function pubmedTermToOvid(term) {
  const t = String(term || "").trim();
  if (!t) return { terms: [], changes: [] };
  const prox = t.match(/^"([^"]+)"\s*\[(?:tiab|ti|title|title\/abstract|ad):~(\d+)\]$/i);
  if (prox) {
    const words = prox[1].trim().split(/\s+/);
    const n = Number(prox[2]) + 1;
    const ovid = words.join(` adj${n} `);
    return { terms: [ovid], changes: [{ kind: "same", ovid, pubmed: t, why: "" }] };
  }
  const tag = t.match(/^(.*?)\s*\[([a-z: /]+)\]$/i);
  let body = tag ? tag[1] : t;
  const changes = [];
  if (tag && !/^(tiab|tw|ti|title\/abstract|text word)$/i.test(tag[2])) {
    changes.push({ kind: "check", ovid: body, pubmed: t, why: `The [${tag[2]}] tag was removed; stage 5 searches titles and abstracts.` });
  }
  body = body.replace(/^"(.*)"$/, "$1");
  return { terms: [body], changes };
}

// Converts a whole stage 3 box (one term per line) to the other database's syntax.
// Returns { text, changed: [{ from, to }] }.
export function convertTerms(text, to) {
  const lines = String(text || "").split(/\n/);
  const changed = [];
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const r = to === "pubmed" ? ovidTermToPubmed(t) : pubmedTermToOvid(t);
    const terms = r.terms.length ? r.terms : [t];
    if (terms.length !== 1 || terms[0] !== t) changed.push({ from: t, to: terms.join(", ") });
    out.push(...terms);
  }
  return { text: out.join("\n"), changed };
}

// ---------- Checking terms as they're typed (stage 3) ----------

export function checkTerm(term, database) {
  const t = String(term || "").trim();
  const issues = [];
  if (!t) return issues;
  const words = t.replace(/"/g, "").split(/\s+/);
  if (database === "pubmed") {
    if (t.includes("$")) issues.push("PubMed uses * for truncation, not $.");
    if (WILDCARD.test(t)) issues.push("PubMed has no one-letter wildcard (# or ?). List each spelling instead.");
    if (/\badj\d*\b/i.test(t)) issues.push('adj is Ovid. In PubMed, write "word1 word2"[tiab:~2].');
    if (/\*\d/.test(t)) issues.push("PubMed has no limited truncation. List the forms instead, e.g. boy and boys.");
    const stem = t.replace(/^"/, "").match(/^([^*"]*)\*/);
    if (stem && letters(stem[1]).length < PUBMED_MIN_STEM) issues.push(`PubMed needs at least ${PUBMED_MIN_STEM} letters before *.`);
    if (/~\d/.test(t) && t.includes("*")) issues.push("PubMed ignores proximity when the words contain *.");
    if (/"\s*~\d/.test(t)) issues.push('Put the ~ inside a field tag, e.g. "word1 word2"[tiab:~2].');
  } else {
    if (/\[[a-z: /~0-9]+\]/i.test(t)) issues.push("[tiab] and ~ are PubMed. In Ovid use adj3; stage 5 adds .ti,ab. for you.");
    if (words.some((w) => /^[$*#?]/.test(w))) issues.push("Truncation and wildcards can't be the first character of a word.");
    if (/\badj\b(?!\d)/i.test(t)) issues.push("adj on its own means next to each other, in the order typed. Did you mean adj2 or adj3?");
    if (/\s(adj\d*)\s*$/i.test(t) || /^\s*adj\d*\s/i.test(t)) issues.push("adj needs a word on each side.");
    if (!balanced(t)) issues.push("A bracket isn't closed.");
  }
  return issues;
}
