// Database Search Tutorial – five-stage interactive tutorial.
// Plain JavaScript modules, no build step, so it runs on GitHub Pages and in a Codespace unchanged.

import { autoConnect, canWake, connectTo, connection, lookupMesh, pubmedCount, requestFeedback, setPasscode, wakeTutor } from "./api.js";
import { buildBlock, checkSyntax, combineBlocks, dropCovered, meshTerm, OPERATORS, parseTerms } from "./shared/strategy.js";
import { buildOvidHistory, checkTerm, convertTerms, DATABASES, ovidHeading, ovidKeywordLine, translateOvidHistory } from "./shared/ovid.js";
import { pubmedUrl } from "./shared/ncbi.js";

const STAGES = [
  { n: 1, short: "Question", title: "Focus your research question" },
  { n: 2, short: "Concepts", title: "Identifying your Search Concepts" },
  { n: 3, short: "Synonyms", title: "Finding alternative terms" },
  { n: 4, short: "MeSH", title: "Using Medical Subject Headings" },
  { n: 5, short: "Strategy", title: "Combining your search" },
];
const MAX_CONCEPTS = 5;
const MODEL_ANSWER_FROM_ATTEMPT = 3;
const HISTORY_SENT = 3; // previous attempts per stage the tutor sees
const STATE_KEY = "dst-state-v1";

// ---------- State ----------

function freshState() {
  return {
    stage: 1,
    reached: 1,
    database: "ovid", // "ovid" | "pubmed": which syntax the student writes their search in
    convertOffer: null, // { to, concepts: [{ concept, text, changed }] } after switching database
    question: "",
    concepts: [""],
    synonyms: {}, // concept -> text
    mesh: {}, // concept -> { term, results, selected, noHeading }
    blocks: {}, // concept -> { query, edited } (PubMed)
    ovidLines: {}, // concept -> { text, edited } (the Ovid keyword line)
    counts: {}, // PubMed query -> { count, warnings } (Ovid lines are counted through PubMed)
    operators: [],
    blockCounts: {}, // concept -> { query, count }
    finalCount: null, // { query, count, warnings, queryTranslation }
    feedback: {}, // stage -> { feedback, source, notice, attempt, provider, model }
    attempts: {}, // stage -> number
    history: {}, // stage -> [{ attempt, work, feedback }] – live AI feedback only, sent back as context
    notes: {}, // stage -> the student's optional notes for the tutor (never added to the search)
  };
}

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    // Work saved before the Ovid option existed was written for PubMed.
    return saved ? { ...freshState(), database: "pubmed", ...saved } : freshState();
  } catch {
    return freshState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable; progress just won't survive a reload.
  }
}

const concepts = () => state.concepts.map((c) => c.trim()).filter(Boolean);
const meshFor = (c) => (state.mesh[c] ||= { term: c, results: [], selected: [], noHeading: false });
const synonymsFor = (c) => parseTerms(state.synonyms[c] || "");

// ---------- DOM helper ----------

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "value") el.value = value;
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && typeof value !== "string") el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const $ = (id) => document.getElementById(id);

// ---------- Navigation ----------

function goTo(n) {
  state.stage = n;
  state.reached = Math.max(state.reached, n);
  saveState();
  render();
  const heading = document.querySelector("#stage h1");
  heading?.focus();
  window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function renderStepper() {
  const list = $("stepper");
  list.replaceChildren(
    ...STAGES.map((s) => {
      const current = s.n === state.stage;
      const done = s.n < state.reached || (s.n === state.reached && state.feedback[s.n]);
      return h(
        "li",
        { class: `step${current ? " current" : ""}${done && !current ? " done" : ""}` },
        h(
          "button",
          {
            type: "button",
            disabled: s.n > state.reached,
            "aria-current": current ? "step" : null,
            onclick: () => goTo(s.n),
          },
          h("span", { class: "step-num", "aria-hidden": "true", text: String(s.n) }),
          h("span", { class: "step-label" }, h("span", { class: "visually-hidden", text: `Stage ${s.n}: ` }), s.short),
        ),
      );
    }),
  );
}

function stageHeader(n, intro) {
  const s = STAGES[n - 1];
  return [
    h("p", { class: "eyebrow", text: `Stage ${n} of ${STAGES.length}` }),
    h("h1", { tabindex: "-1", text: s.title }),
    h("div", { class: "intro" }, intro),
  ];
}

// `blocker` returns a message when the student isn't ready to move on, or "".
function navButtons(n, blocker = () => "") {
  const message = h("div", { class: "nav-message" });
  return h(
    "div",
    { class: "nav-buttons" },
    n > 1 ? h("button", { type: "button", class: "button secondary", onclick: () => goTo(n - 1) }, "← Previous") : h("span"),
    message,
    n < STAGES.length
      ? h(
          "button",
          {
            type: "button",
            class: "button secondary",
            onclick: () => {
              const problem = blocker();
              if (problem) message.replaceChildren(inlineError(problem));
              else goTo(n + 1);
            },
          },
          "Next →",
        )
      : h("span"),
  );
}

function questionBox() {
  return h(
    "div",
    { class: "question-box" },
    h("p", { class: "label", text: "Your research question" }),
    h("p", { class: "question-text", text: state.question.trim() || "You haven't written a question yet. Go back to stage 1." }),
  );
}

function learnMore(summary, ...content) {
  return h("details", { class: "learn-more" }, h("summary", { text: summary }), h("div", {}, ...content));
}

// ---------- Feedback ----------

const VERDICT_LABELS = { strong: "Strong", developing: "Developing", needs_work: "Needs work" };
const STATUS_LABELS = { strong: "Good", developing: "Could improve", missing: "Missing" };

function feedbackPanel(n) {
  const entry = state.feedback[n];
  const panel = h("section", { class: "feedback-region", "aria-live": "polite", "aria-label": "Tutor feedback" });
  if (!entry) return panel;
  if (entry.error) {
    panel.append(
      h(
        "div",
        { class: "alert error", role: "alert" },
        h("p", { text: entry.error }),
        entry.errorCode === "passcode" ? h("button", { type: "button", class: "button small", onclick: openConnection }, "Enter passcode") : null,
      ),
    );
    return panel;
  }

  const f = entry.feedback || {};
  const sourceText =
    entry.source === "live"
      ? `Live AI tutor${entry.provider ? ` · ${entry.provider === "copilot" ? "GitHub Copilot" : entry.provider}` : ""}${entry.model ? ` (${entry.model})` : ""}`
      : "Example feedback (offline demo, not AI)";

  panel.append(
    h(
      "article",
      { class: `feedback verdict-${f.verdict || "developing"}` },
      h(
        "header",
        { class: "feedback-header" },
        h("h2", { text: "Tutor feedback" }),
        h("span", { class: `verdict-badge ${f.verdict || "developing"}`, text: VERDICT_LABELS[f.verdict] || "Developing" }),
      ),
      h("p", { class: "source", text: `${sourceText} · attempt ${entry.attempt}` }),
      entry.notice ? h("p", { class: "alert warning", text: entry.notice }) : null,
      f.summary ? h("p", { class: "summary", text: f.summary }) : null,
      f.items?.length
        ? h(
            "ul",
            { class: "items" },
            f.items.map((i) =>
              h(
                "li",
                { class: `item ${i.status}` },
                h("span", { class: `status-chip ${i.status}`, text: STATUS_LABELS[i.status] || i.status }),
                h(
                  "div",
                  {},
                  h("p", { class: "item-label", text: i.label }),
                  h("p", { class: "item-comment", text: i.comment }),
                  i.unchanged ? h("p", { class: "item-note", text: "Unchanged since your last submission" }) : null,
                ),
              ),
            ),
          )
        : null,
      f.strengths?.length ? h("div", { class: "fb-block" }, h("h3", { text: "What's working" }), h("ul", { class: "ticks" }, f.strengths.map((s) => h("li", { text: s })))) : null,
      f.suggestions?.length ? h("div", { class: "fb-block" }, h("h3", { text: "Try this" }), h("ol", {}, f.suggestions.map((s) => h("li", { text: s })))) : null,
      f.question ? h("div", { class: "reflect" }, h("h3", { text: "Think about" }), h("p", { text: f.question })) : null,
      f.modelAnswer
        ? h("details", { class: "model-answer" }, h("summary", { text: "Show a worked example" }), h("p", { class: "pre", text: f.modelAnswer }))
        : entry.source === "live" && entry.attempt < MODEL_ANSWER_FROM_ATTEMPT
          ? h("p", { class: "muted small", text: `Improve your work and resubmit. A worked example is offered from attempt ${MODEL_ANSWER_FROM_ATTEMPT}.` })
          : null,
    ),
  );
  return panel;
}

// What the tutor said before: earlier attempts at this stage, and the latest feedback on earlier stages.
function tutorContext(n) {
  const history = (state.history[n] || []).slice(-HISTORY_SENT);
  const earlier = [];
  for (let s = 1; s < n; s += 1) {
    const last = (state.history[s] || []).at(-1);
    if (last) earlier.push({ stage: s, feedback: last.feedback, notes: last.work?.notes || "" });
  }
  return { history, earlier };
}

async function submitFeedback(n, data, button) {
  const attempt = (state.attempts[n] || 0) + 1;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = connection.mode === "live" ? "The tutor is reading your work…" : "Checking…";
  button.setAttribute("aria-busy", "true");
  try {
    data = { ...data, notes: (state.notes[n] || "").trim() };
    const result = await requestFeedback(n, data, attempt, tutorContext(n));
    state.attempts[n] = attempt;
    state.feedback[n] = { ...result, attempt };
    renderConnection();
    if (result.source === "live") {
      state.history[n] = [...(state.history[n] || []), { attempt, work: data, feedback: result.feedback }].slice(-HISTORY_SENT);
    }
  } catch (err) {
    state.feedback[n] = { error: err.message, errorCode: err.body?.code, attempt };
  } finally {
    button.disabled = false;
    button.textContent = original;
    button.removeAttribute("aria-busy");
  }
  saveState();
  render();
  document.querySelector(".feedback-region")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// Optional notes for the tutor. Only the tutor sees them; they never become part of the search.
const NOTES_EXAMPLES = {
  1: "e.g. This is for a quick answer for a clinical team, not a systematic review.",
  2: "e.g. I want papers on either triptans or NSAIDs, not only comparisons between them.",
  3: "e.g. Sumatriptan is the triptan most often prescribed in the UK.",
  4: "e.g. I couldn't find a heading for HbA1c, so I'm relying on keywords.",
  5: "e.g. I've used OR between #2 and #3 because either treatment is relevant.",
};

function notesBox(n) {
  const id = `notes-${n}`;
  return h(
    "div",
    { class: "notes-box" },
    h("label", { for: id, class: "field-label" }, "Notes for the tutor ", h("span", { class: "muted", text: "(optional)" })),
    h("textarea", {
      id,
      rows: 2,
      value: state.notes[n] || "",
      placeholder: NOTES_EXAMPLES[n],
      "aria-describedby": `${id}-hint`,
      oninput: (e) => {
        state.notes[n] = e.target.value;
        saveState();
      },
    }),
    h("p", {
      id: `${id}-hint`,
      class: "hint",
      text: "Explain your choices, or anything the tutor should take into account. Notes are only shared with the tutor and are never added to your search.",
    }),
  );
}

function inlineError(text) {
  return h("p", { class: "field-error", role: "alert", text });
}

// ---------- Stage 1: research question ----------

function stage1() {
  const textarea = h("textarea", {
    id: "question",
    rows: 4,
    value: state.question,
    placeholder: "e.g. In adults with type 2 diabetes, does a structured exercise programme improve blood glucose control compared with usual care?",
    "aria-describedby": "question-hint",
    oninput: (e) => {
      state.question = e.target.value;
      saveState();
    },
    onkeydown: (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        analyse();
      }
    },
  });
  const errorSlot = h("div");
  const button = h("button", { type: "button", class: "button", onclick: () => analyse() }, "Analyse my question");

  function analyse() {
    errorSlot.replaceChildren();
    if (!state.question.trim()) {
      errorSlot.append(inlineError("Type your research question first."));
      textarea.focus();
      return;
    }
    submitFeedback(1, { question: state.question }, button);
  }

  return h(
    "section",
    { class: "card" },
    stageHeader(1, [
      h("p", {}, "A focused question makes searching much easier. ", h("strong", { text: "PICO" }), " breaks a clinical question into its parts:"),
      h(
        "dl",
        { class: "pico-grid" },
        [
          ["P", "Population or problem", "Who is it about?"],
          ["I", "Intervention or exposure", "What is being done or studied?"],
          ["C", "Comparison", "Compared with what? (optional)"],
          ["O", "Outcome", "What is measured?"],
        ].map(([letter, name, q]) => h("div", {}, h("dt", {}, h("span", { class: "pico-letter", text: letter }), name), h("dd", { text: q }))),
      ),
    ]),
    h("label", { for: "question", class: "field-label", text: "Your research question" }),
    textarea,
    h("p", { id: "question-hint", class: "hint", text: "Press Enter to analyse (Shift+Enter for a new line). Edit your question in the same box and analyse again as often as you like." }),
    errorSlot,
    notesBox(1),
    h("div", { class: "actions" }, button),
    feedbackPanel(1),
    navButtons(1, () => (state.question.trim() ? "" : "Write your research question before moving on.")),
  );
}

// ---------- Stage 2: search concepts ----------

function stage2() {
  const errorSlot = h("div");
  const button = h("button", { type: "button", class: "button", onclick: () => submit() }, "Submit");

  function submit() {
    errorSlot.replaceChildren();
    if (concepts().length === 0) {
      errorSlot.append(inlineError("Enter at least one search concept."));
      return;
    }
    submitFeedback(2, { question: state.question, concepts: concepts() }, button);
  }

  const fields = state.concepts.map((value, i) =>
    h(
      "div",
      { class: "concept-row" },
      h("label", { for: `concept-${i}`, class: "field-label", text: `Search Concept ${i + 1}` }),
      h(
        "div",
        { class: "input-with-button" },
        h("input", {
          id: `concept-${i}`,
          type: "text",
          value,
          autocomplete: "off",
          oninput: (e) => {
            state.concepts[i] = e.target.value;
            saveState();
          },
        }),
        state.concepts.length > 1
          ? h(
              "button",
              {
                type: "button",
                class: "button icon secondary",
                "aria-label": `Remove search concept ${i + 1}`,
                onclick: () => {
                  state.concepts.splice(i, 1);
                  saveState();
                  render();
                },
              },
              "×",
            )
          : null,
      ),
    ),
  );

  return h(
    "section",
    { class: "card" },
    stageHeader(2, [
      h("p", { text: "Search concepts are the key ideas that a relevant paper must be about. Most searches use two to four, taken from your PICO." }),
      h("p", { text: "Identify the key search concepts in your research question below. Put one concept in each box." }),
      learnMore(
        "Tips for choosing concepts",
        h(
          "ul",
          {},
          h("li", { text: "One idea per box: “older adults with diabetes” is two concepts." }),
          h("li", { text: "The comparison is often left out, as it's described inconsistently in abstracts." }),
          h("li", { text: "Leave out generic words like “effect”, “impact” or “treatment”." }),
          h("li", { text: "Leave out study designs (e.g. “randomised controlled trial”) for now." }),
        ),
      ),
    ]),
    questionBox(),
    h("div", { class: "concepts" }, fields),
    errorSlot,
    notesBox(2),
    h(
      "div",
      { class: "actions" },
      button,
      state.concepts.length < MAX_CONCEPTS
        ? h(
            "button",
            {
              type: "button",
              class: "button secondary",
              onclick: () => {
                state.concepts.push("");
                saveState();
                render();
                $(`concept-${state.concepts.length - 1}`)?.focus();
              },
            },
            "Add Concept",
          )
        : null,
    ),
    feedbackPanel(2),
    navButtons(2, () => (concepts().length ? "" : "Enter at least one search concept before moving on.")),
  );
}

// ---------- Stage 3: synonyms ----------

function stage3() {
  const list = concepts();
  const button = h("button", { type: "button", class: "button", onclick: () => submit() }, "Submit");
  const ovid = state.database === "ovid";

  function submit() {
    submitFeedback(
      3,
      { question: state.question, database: state.database, concepts: list.map((c) => ({ concept: c, synonyms: synonymsFor(c) })) },
      button,
    );
  }

  return h(
    "section",
    { class: "card" },
    databaseSwitch(),
    stageHeader(3, [
      h("p", { text: "Authors describe the same idea in many different ways. To find all the relevant papers, list the other words they might use for each concept." }),
      learnMore(
        "What kinds of alternative terms?",
        h(
          "ul",
          {},
          h("li", { text: "Synonyms and lay terms: heart attack, myocardial infarction" }),
          h("li", { text: "Abbreviations: COPD, chronic obstructive pulmonary disease" }),
          h("li", { text: ovid ? "UK and US spellings: paediatric, pediatric (or p?ediatric in Ovid)" : "UK and US spellings: paediatric, pediatric" }),
          h("li", { text: "Truncation for word endings: child* finds child, children, childhood" }),
          h("li", { text: "Phrases: just type the words, e.g. physical activity" }),
          h("li", { text: "Specific examples within a group, e.g. individual drug names" }),
        ),
      ),
    ]),
    operatorGuide(),
    questionBox(),
    list.length === 0
      ? h("p", { class: "alert warning", text: "Add your search concepts in stage 2 first." })
      : h(
          "div",
          { class: "concept-cards" },
          list.map((c, i) => {
            const check = h("div", { class: "term-check", "aria-live": "polite" }, termChecks(state.synonyms[c] || ""));
            return h(
              "div",
              { class: "concept-card" },
              h("label", { for: `syn-${i}`, class: "field-label" }, "Alternative terms for ", h("strong", { text: c })),
              h("textarea", {
                id: `syn-${i}`,
                class: "code",
                rows: Math.min(12, Math.max(5, (state.synonyms[c] || "").split("\n").length + 1)),
                value: state.synonyms[c] || "",
                placeholder: "One term per line",
                spellcheck: "false",
                "aria-describedby": `syn-hint-${i}`,
                oninput: (e) => {
                  state.synonyms[c] = e.target.value;
                  saveState();
                  check.replaceChildren(...termChecks(e.target.value));
                },
              }),
              check,
              h("p", { id: `syn-hint-${i}`, class: "hint" }, "“", c, "” is already included in your search, so just list the other words authors might use."),
            );
          }),
        ),
    list.length ? notesBox(3) : null,
    h("div", { class: "actions" }, list.length ? button : null),
    feedbackPanel(3),
    navButtons(3),
  );
}

// The key operators for the selected database, shown at the top of stage 3.
const OPERATOR_GUIDES = {
  ovid: {
    rows: [
      ["* or $", "Truncation: any word ending", "migrain*", "finds migraine, migraines, migrainous"],
      ["*1, *2…", "Limited truncation: up to that many extra letters", "boy*1", "finds boy, boys and any other word with one more letter, but not boyfriend"],
      ["#", "Wildcard: exactly one letter", "wom#n", "finds woman, women"],
      ["?", "Wildcard: one letter or none", "p?ediatric*", "finds paediatric, pediatric, paediatrics, pediatrician"],
      ["Phrase", "Just type the words. Ovid finds them together, in that order", "abdominal migraine", ""],
      ["adj3", "Proximity: both words, in either order, with up to 2 words between (adjn allows n−1)", "migraine adj3 attack*", "finds “migraine attacks”, “attacks of migraine”"],
    ],
    tips: [
      "Truncation and wildcards can't be the first character of a word.",
      "In Ovid, untick Map Term to Subject Heading when you use these symbols. Stage 5 adds .ti,ab. (title and abstract) to your terms for you.",
    ],
  },
  pubmed: {
    rows: [
      ["* at the end", "Truncation: any word ending. You need at least 4 letters before the *", "migrain*", "finds migraine, migraines, migrainous"],
      ["* inside a word", "Wildcard: any number of letters, or none. You need at least 4 letters before it", "randomi*ed", "finds randomised, randomized"],
      ["Phrase", "Just type the words. We add the quotation marks for you in stage 5", "abdominal migraine", "becomes \"abdominal migraine\"[tiab]"],
      ["[tiab:~2]", "Proximity: the words in quotes, in either order, with up to 2 words between. Type the quotes and the tag yourself", "\"migraine attack\"[tiab:~2]", "finds “attack of migraine”"],
    ],
    tips: [
      "PubMed has no one-letter wildcard (# or ?) and no limited truncation. List the forms instead, for example boy and boys.",
      "Proximity works only in titles and abstracts, and can't be used with *.",
      "Truncation switches off PubMed's automatic mapping to subject headings, so keep your MeSH headings from stage 4.",
    ],
  },
};

function operatorGuide() {
  const guide = OPERATOR_GUIDES[state.database];
  return h(
    "div",
    { class: "ops" },
    h("h2", { text: `Key operators in ${DATABASES[state.database].name}` }),
    h(
      "div",
      { class: "ops-table-wrap" },
      h(
        "table",
        {},
        h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Type" }), h("th", { scope: "col", text: "What it does" }), h("th", { scope: "col", text: "Example" }))),
        h(
          "tbody",
          {},
          guide.rows.map(([symbol, what, example, finds]) =>
            h("tr", {}, h("td", {}, h("code", { text: symbol })), h("td", { text: what }), h("td", { class: "eg" }, h("code", { text: example }), finds ? ` ${finds}` : "")),
          ),
        ),
      ),
    ),
    h("ul", {}, guide.tips.map((t) => h("li", { text: t }))),
  );
}

// Checks each term as it's typed, for the selected database (no AI involved).
function termChecks(text) {
  const terms = String(text || "").split(/\n+/).map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return [];
  const issues = terms.flatMap((t) => checkTerm(t, state.database).map((m) => `“${t}”: ${m}`));
  if (issues.length === 0) {
    return [h("span", { class: "chip ok", text: `✓ ${terms.length} term${terms.length === 1 ? "" : "s"}, ${DATABASES[state.database].short} syntax looks right` })];
  }
  return issues.map((m) => h("span", { class: "chip bad", text: `✕ ${m}` }));
}

// ---------- Choosing the database (stages 3–5) ----------

let convertNotice = "";

function setDatabase(db) {
  if (db === state.database || !DATABASES[db]) return;
  state.database = db;
  convertNotice = "";
  // Offer to convert terms already typed in the other database's syntax.
  const concepts = [];
  for (const c of Object.keys(state.synonyms)) {
    const r = convertTerms(state.synonyms[c], db);
    if (r.changed.length) concepts.push({ concept: c, text: r.text, changed: r.changed });
  }
  state.convertOffer = concepts.length ? { to: db, concepts } : null;
  saveState();
  render();
  $("db-toggle")?.focus();
}

function convertBanner() {
  const offer = state.convertOffer;
  if (convertNotice) return h("p", { class: "alert success", role: "status", text: convertNotice });
  if (!offer || offer.to !== state.database) return null;
  const from = DATABASES[offer.to === "ovid" ? "pubmed" : "ovid"].name;
  const changes = offer.concepts.flatMap((c) => c.changed);
  const shown = changes.slice(0, 6);
  return h(
    "div",
    { class: "convert-offer", role: "region", "aria-label": "Convert your terms" },
    h("p", { class: "convert-title", text: `Your alternative terms are written for ${from}.` }),
    h("p", { text: `Convert them to ${DATABASES[offer.to].name} syntax? These terms would change:` }),
    h(
      "ul",
      {},
      shown.map((c) => h("li", {}, h("code", { text: c.from }), " → ", h("code", { text: c.to }))),
      changes.length > shown.length ? h("li", { text: `and ${changes.length - shown.length} more` }) : null,
    ),
    h(
      "div",
      { class: "actions" },
      h(
        "button",
        {
          type: "button",
          class: "button small",
          onclick: () => {
            for (const c of offer.concepts) state.synonyms[c.concept] = c.text;
            state.convertOffer = null;
            convertNotice = `Your terms are now in ${DATABASES[offer.to].name} syntax. Check them in stage 3.`;
            saveState();
            render();
          },
        },
        "Convert my terms",
      ),
      h(
        "button",
        {
          type: "button",
          class: "button secondary small",
          onclick: () => {
            state.convertOffer = null;
            saveState();
            render();
          },
        },
        "Keep them as they are",
      ),
    ),
  );
}

function databaseSwitch() {
  const side = (db) =>
    h(
      "span",
      { class: `db-side${state.database === db ? " on" : ""}`, "aria-hidden": "true", onclick: () => setDatabase(db) },
      h("span", { class: "tick", text: "✓" }),
      DATABASES[db].name,
    );
  return h(
    "div",
    { class: "db-area" },
    h(
      "div",
      { class: "db-row" },
      h(
        "div",
        { class: "db-switch" },
        h("span", { class: "lead", text: "Database" }),
        side("ovid"),
        h("input", {
          type: "checkbox",
          class: "slider",
          role: "switch",
          id: "db-toggle",
          checked: state.database === "pubmed",
          "aria-label": "Use PubMed instead of Ovid MEDLINE",
          onchange: (e) => setDatabase(e.target.checked ? "pubmed" : "ovid"),
        }),
        side("pubmed"),
      ),
    ),
    convertBanner(),
  );
}

// ---------- Stage 4: MeSH ----------

function meshResult(c, r) {
  const m = meshFor(c);
  const checked = m.selected.some((s) => s.ui === r.ui);
  const id = `mesh-${c.replace(/\W+/g, "-")}-${r.ui}`;
  return h(
    "li",
    { class: `mesh-result${checked ? " selected" : ""}` },
    h(
      "div",
      { class: "mesh-top" },
      h("input", {
        type: "checkbox",
        id,
        checked,
        onchange: (e) => {
          if (e.target.checked) {
            m.selected.push({ ui: r.ui, heading: r.heading, scopeNote: r.scopeNote, treeNumbers: r.treeNumbers });
            m.noHeading = false;
          } else m.selected = m.selected.filter((s) => s.ui !== r.ui);
          saveState();
          render();
        },
      }),
      h("label", { for: id, class: "mesh-heading", text: r.heading }),
      h("a", { href: r.url, target: "_blank", rel: "noopener", class: "small" }, `${r.ui} ↗`, h("span", { class: "visually-hidden", text: " (opens MeSH Browser in a new tab)" })),
    ),
    r.scopeNote ? h("p", { class: "scope-note", text: r.scopeNote }) : null,
    r.entryTerms?.length ? h("p", { class: "small muted" }, h("strong", { text: "Also covers: " }), r.entryTerms.slice(0, 8).join("; ")) : null,
    r.treeNumbers?.length ? h("p", { class: "small muted" }, h("strong", { text: "Tree: " }), r.treeNumbers.join(", ")) : null,
  );
}

function meshCard(c, i) {
  const m = meshFor(c);
  const status = h("div", { class: "lookup-status", "aria-live": "polite" });
  const input = h("input", {
    id: `mesh-term-${i}`,
    type: "search",
    value: m.term,
    oninput: (e) => {
      m.term = e.target.value;
      saveState();
    },
    onkeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        search();
      }
    },
  });
  const button = h("button", { type: "button", class: "button secondary", onclick: () => search() }, "Look up");

  async function search() {
    const term = m.term.trim();
    if (!term) return;
    button.disabled = true;
    status.replaceChildren(h("p", { class: "muted small", text: "Searching MeSH…" }));
    try {
      m.results = await lookupMesh(term);
      m.error = "";
      m.looked = true;
    } catch (err) {
      m.error = `The look-up didn't work: ${err.message}`;
    }
    button.disabled = false;
    saveState();
    render();
    $(`mesh-term-${i}`)?.focus();
  }

  return h(
    "div",
    { class: "concept-card" },
    h("h2", { class: "concept-title" }, "Concept: ", h("span", { text: c })),
    h("label", { for: `mesh-term-${i}`, class: "field-label", text: "Look up a word or phrase in MeSH" }),
    h("div", { class: "input-with-button" }, input, button),
    status,
    m.error ? h("p", { class: "alert error", text: m.error }) : null,
    m.results?.length
      ? h("ul", { class: "mesh-results", "aria-label": `MeSH headings matching ${m.term}` }, m.results.map((r) => meshResult(c, r)))
      : m.looked && !m.error
        ? h("p", { class: "muted", text: "No headings found. Try a synonym." })
        : null,
    m.selected.length
      ? h("div", { class: "chosen" }, h("h3", { text: "Your headings" }), m.selected.map((s, j) => chosenHeading(s, `${i}-${j}`)))
      : null,
    h(
      "label",
      { class: "checkbox-line" },
      h("input", {
        type: "checkbox",
        checked: m.noHeading,
        onchange: (e) => {
          m.noHeading = e.target.checked;
          if (m.noHeading) m.selected = [];
          saveState();
          render();
        },
      }),
      "There's no suitable heading for this concept",
    ),
  );
}

// A chosen heading, with its Explode tick box and how it will be written in the selected database.
function chosenHeading(s, id) {
  const explode = s.explode !== false;
  const written = state.database === "ovid" ? ovidHeading(s.heading, explode) : meshTerm(s.heading, { explode });
  return h(
    "div",
    { class: "chosen-heading" },
    h(
      "div",
      { class: "chosen-top" },
      h("span", { class: "tag", text: s.heading }),
      h(
        "label",
        { class: "explode", for: `explode-${id}` },
        h("input", {
          type: "checkbox",
          id: `explode-${id}`,
          checked: explode,
          onchange: (e) => {
            s.explode = e.target.checked;
            saveState();
            render();
            $(`explode-${id}`)?.focus();
          },
        }),
        "Explode",
      ),
    ),
    h("p", { class: "written" }, h("span", { class: "muted", text: "Written as " }), h("code", { text: written })),
  );
}

function stage4() {
  const list = concepts();
  const button = h("button", { type: "button", class: "button", onclick: () => submit() }, "Get feedback on my headings");

  function submit() {
    submitFeedback(
      4,
      {
        question: state.question,
        database: state.database,
        concepts: list.map((c) => ({
          concept: c,
          headings: meshFor(c).selected.map((s) => ({ ...s, explode: s.explode !== false })),
          noHeading: meshFor(c).noHeading,
        })),
      },
      button,
    );
  }

  return h(
    "section",
    { class: "card" },
    databaseSwitch(),
    stageHeader(4, [
      h(
        "p",
        {},
        h("strong", { text: "Medical Subject Headings (MeSH)" }),
        " are a controlled vocabulary. Indexers tag each MEDLINE article with headings, so searching a heading finds papers whatever words the authors used.",
      ),
      h("p", { text: "Look up each concept, read the scope notes, and tick the heading(s) that match what you mean." }),
      learnMore(
        "More about MeSH",
        h(
          "ul",
          {},
          h("li", {
            text: "Headings sit in hierarchical trees. Exploding a heading includes the narrower headings beneath it too. Untick Explode if you only want the heading itself.",
          }),
          h("li", { text: "In Ovid, exp before a heading explodes it. PubMed explodes headings unless you add :NoExp." }),
          h("li", { text: "MeSH is the same in Ovid MEDLINE and PubMed, because both search MEDLINE." }),
          h("li", { text: "Not every concept has a heading, and the newest papers aren't indexed yet, so keep using your keywords as well." }),
          h("li", { text: "Other databases use their own vocabularies (Emtree in Embase, CINAHL Headings in CINAHL)." }),
        ),
      ),
    ]),
    list.length === 0 ? h("p", { class: "alert warning", text: "Add your search concepts in stage 2 first." }) : h("div", { class: "concept-cards" }, list.map(meshCard)),
    list.length ? notesBox(4) : null,
    h("div", { class: "actions" }, list.length ? button : null),
    feedbackPanel(4),
    navButtons(4),
  );
}

// ---------- Stage 5: Boolean strategy ----------

function generatedBlock(c) {
  return buildBlock({ concept: c, synonyms: synonymsFor(c), meshHeadings: meshFor(c).selected.map((s) => ({ heading: s.heading, explode: s.explode !== false })) });
}

function blockFor(c) {
  const b = state.blocks[c];
  if (!b || !b.edited) state.blocks[c] = { query: generatedBlock(c), edited: false };
  return state.blocks[c];
}

function finalStrategy(list) {
  return combineBlocks(
    list.map((c) => blockFor(c).query),
    state.operators,
  );
}

function countDisplay(entry, query) {
  if (!entry || entry.query !== query) return null;
  return h("p", { class: "count" }, h("strong", { text: entry.count.toLocaleString("en-GB") }), ` PubMed record${entry.count === 1 ? "" : "s"}`);
}

async function runCount(query, button, store) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Searching PubMed…";
  try {
    const r = await pubmedCount(query);
    store({ query, count: r.count, warnings: r.warnings, queryTranslation: r.queryTranslation });
    saveState();
    render();
  } catch (err) {
    button.disabled = false;
    button.textContent = original;
    button.after(inlineError(`The PubMed search didn't work: ${err.message}`));
  }
}

function finalSection(list) {
  const strategy = finalStrategy(list);
  const problems = strategy ? checkSyntax(strategy) : [];
  const finalCount = state.finalCount?.query === strategy ? state.finalCount : null;
  const finalButton = h(
    "button",
    { type: "button", class: "button secondary", disabled: !strategy, onclick: () => runCount(strategy, finalButton, (v) => (state.finalCount = v)) },
    "Count results",
  );
  return h(
    "div",
    { class: "final-strategy", id: "final-strategy", "aria-live": "polite" },
    h("h2", { text: "Your search strategy" }),
    strategy
      ? h("pre", { class: "code-block", tabindex: "0", text: strategy })
      : h("p", { class: "muted", text: list.length > 1 ? "Choose an operator between each pair of lines to see the full search." : "Your search line will appear here." }),
    problems.length ? h("ul", { class: "alert warning" }, problems.map((p) => h("li", { text: p }))) : null,
    h(
      "div",
      { class: "block-actions" },
      finalButton,
      strategy ? h("a", { class: "button link", href: pubmedUrl(strategy), target: "_blank", rel: "noopener" }, "Open in PubMed ↗") : null,
      finalCount ? countDisplay(finalCount, strategy) : null,
    ),
    finalCount?.warnings?.length ? h("p", { class: "alert warning small", text: `PubMed: ${finalCount.warnings.join(" ")}` }) : null,
  );
}

function stage5() {
  return state.database === "ovid" ? stage5Ovid() : stage5Pubmed();
}

function stage5Pubmed() {
  const list = concepts();
  const feedbackButton = h("button", { type: "button", class: "button", onclick: () => submit() }, "Get feedback on my strategy");

  function submit() {
    const strategy = finalStrategy(list);
    submitFeedback(
      5,
      {
        question: state.question,
        database: "pubmed",
        blocks: list.map((c) => {
          const q = blockFor(c).query;
          const counted = state.blockCounts[c];
          return { concept: c, query: q, count: counted?.query === q ? counted.count : undefined };
        }),
        operators: state.operators.slice(0, Math.max(0, list.length - 1)),
        strategy,
        count: state.finalCount?.query === strategy ? state.finalCount.count : undefined,
        warnings: state.finalCount?.query === strategy ? state.finalCount.warnings : [],
      },
      feedbackButton,
    );
  }

  const blockEls = list.map((c, i) => {
    const b = blockFor(c);
    const countButton = h(
      "button",
      { type: "button", class: "button secondary small", onclick: () => blockFor(c).query.trim() && runCount(blockFor(c).query, countButton, (v) => (state.blockCounts[c] = v)) },
      "Count results",
    );
    const blockCard = h(
      "div",
      { class: "concept-card block" },
      h("label", { for: `block-${i}`, class: "field-label" }, h("span", { class: "line-num", text: `#${i + 1}` }), " ", h("strong", { text: c })),
      h("textarea", {
        id: `block-${i}`,
        class: "code",
        rows: 3,
        value: b.query,
        spellcheck: "false",
        oninput: (e) => {
          state.blocks[c] = { query: e.target.value, edited: true };
          saveState();
          $("final-strategy")?.replaceWith(finalSection(list));
        },
      }),
      h(
        "div",
        { class: "block-actions" },
        countButton,
        b.edited
          ? h(
              "button",
              {
                type: "button",
                class: "button link small",
                onclick: () => {
                  delete state.blocks[c];
                  saveState();
                  render();
                },
              },
              "Rebuild from my terms",
            )
          : null,
        countDisplay(state.blockCounts[c], b.query),
      ),
    );
    if (i === list.length - 1) return blockCard;
    const select = h(
      "select",
      {
        id: `op-${i}`,
        onchange: (e) => {
          state.operators[i] = e.target.value;
          saveState();
          render();
        },
      },
      h("option", { value: "", text: "Choose…" }),
      OPERATORS.map((op) => h("option", { value: op, text: op, selected: state.operators[i] === op })),
    );
    return [blockCard, h("div", { class: "operator" }, h("label", { for: `op-${i}`, text: `Combine #${i + 1} and #${i + 2} with` }), select)];
  });

  return h(
    "section",
    { class: "card" },
    databaseSwitch(),
    stageHeader(5, [
      h("p", {}, "Now combine everything. Within each concept, terms are joined with ", h("code", { text: "OR" }), " to broaden the search. Then choose how to join the concepts together."),
      h("p", { text: "We've built a search line for each concept from your alternative terms and MeSH headings. Check and edit them, count the results, then choose the operators." }),
      learnMore(
        "AND, OR and NOT",
        h(
          "ul",
          {},
          h("li", {}, h("code", { text: "OR" }), " finds papers with any of the terms (more results): use it within a concept."),
          h("li", {}, h("code", { text: "AND" }), " finds papers with all of the concepts (fewer results): use it between concepts."),
          h("li", {}, h("code", { text: "NOT" }), " excludes papers. Use it with great care, because it can remove relevant ones."),
          h("li", {}, h("code", { text: "[Mesh]" }), " searches a subject heading. ", h("code", { text: "[tiab]" }), " searches words in the title and abstract."),
        ),
      ),
    ]),
    questionBox(),
    list.length === 0 ? h("p", { class: "alert warning", text: "Add your search concepts in stage 2 first." }) : h("div", { class: "blocks" }, blockEls),
    list.length ? finalSection(list) : null,
    list.length ? notesBox(5) : null,
    h(
      "div",
      { class: "actions" },
      list.length ? feedbackButton : null,
      h("button", { type: "button", class: "button secondary", onclick: () => downloadStrategy(list) }, "Download my search"),
    ),
    feedbackPanel(5),
    navButtons(5),
    startAgain(),
  );
}

function startAgain() {
  return h(
    "p",
    { class: "start-again" },
    h(
      "button",
      {
        type: "button",
        class: "button link",
        onclick: () => {
          if (confirm("Clear everything and start a new search?")) {
            state = freshState();
            saveState();
            goTo(1);
          }
        },
      },
      "Start a new search",
    ),
  );
}

// ---------- Stage 5 in Ovid MEDLINE: a numbered search history ----------

const LETTERS = "ABCDE";
let translationOpen = false;

function ovidLineFor(c) {
  const saved = state.ovidLines[c];
  if (saved?.edited) return saved.text;
  return ovidKeywordLine(dropCovered([c, ...synonymsFor(c)]));
}

function ovidHistory(list) {
  const history = buildOvidHistory(
    list.map((c) => ({
      concept: c,
      headings: meshFor(c).selected.map((s) => ({ heading: s.heading, explode: s.explode !== false })),
      keywordLine: ovidLineFor(c),
    })),
    state.operators,
  );
  const translated = translateOvidHistory(history.lines);
  return { ...history, lines: translated.lines, byLine: translated.byLine };
}

const countFor = (query) => (query ? state.counts[query] : undefined);

function rememberCount(query, result) {
  state.counts[query] = { count: result.count, warnings: result.warnings || [] };
  const keys = Object.keys(state.counts);
  if (keys.length > 80) delete state.counts[keys[0]];
}

// Counts each query in PubMed (one at a time, to stay within NCBI's rate limit), then re-renders.
async function countQueries(queries, button) {
  const todo = [...new Set(queries.filter((q) => q && !countFor(q)))];
  const original = button.textContent;
  button.disabled = true;
  try {
    for (const [i, q] of todo.entries()) {
      button.textContent = todo.length > 1 ? `Counting ${i + 1} of ${todo.length}…` : "Counting…";
      rememberCount(q, await pubmedCount(q));
    }
    saveState();
    render();
  } catch (err) {
    button.disabled = false;
    button.textContent = original;
    button.after(inlineError(`The PubMed count didn't work: ${err.message}`));
  }
}

function hitsCell(query) {
  const c = countFor(query);
  return h(
    "span",
    { class: "hits" },
    c ? [h("strong", { text: c.count.toLocaleString("en-GB") }), " results"] : h("span", { class: "muted", text: "–" }),
  );
}

function ovidLineRow(line, c, i) {
  const keywords = line.kind === "keywords";
  const body = keywords
    ? [
        h("label", { class: "visually-hidden", for: `ovid-line-${i}`, text: `Line ${line.n}, keywords for ${c}` }),
        h("textarea", {
          id: `ovid-line-${i}`,
          class: "code",
          rows: 2,
          spellcheck: "false",
          value: line.text,
          oninput: (e) => {
            state.ovidLines[c] = { text: e.target.value, edited: true };
            saveState();
          },
          onchange: () => render(),
        }),
      ]
    : h("span", { class: "syntax", text: line.text });
  return h(
    "div",
    { class: `hline ${line.kind}` },
    h("span", { class: "num", text: String(line.n) }),
    h("div", { class: "hline-body" }, body, line.error ? h("p", { class: "field-error small", text: line.error }) : null),
    hitsCell(line.pubmed),
  );
}

function ovidConceptCard(c, i, history) {
  const lines = history.lines.filter((l) => l.concept === c);
  const button = h(
    "button",
    { type: "button", class: "button secondary small", onclick: () => countQueries(lines.map((l) => l.pubmed), button) },
    "Count results",
  );
  return h(
    "div",
    { class: "concept-card block" },
    h("div", { class: "block-head" }, h("span", { class: "line-num", text: LETTERS[i] || String(i + 1) }), h("h2", { text: c })),
    lines.length
      ? h("div", { class: "history" }, lines.map((l) => ovidLineRow(l, c, i)))
      : h("p", { class: "muted", text: "Add alternative terms in stage 3 or headings in stage 4 for this concept." }),
    h(
      "div",
      { class: "block-actions" },
      lines.length ? button : null,
      state.ovidLines[c]?.edited
        ? h(
            "button",
            {
              type: "button",
              class: "button link small",
              onclick: () => {
                delete state.ovidLines[c];
                saveState();
                render();
              },
            },
            "Rebuild from my terms",
          )
        : null,
    ),
  );
}

const MATCH_LABELS = { same: "✓ Same", listed: "⇄ Listed", close: "! Close", check: "✕ Check" };
const MATCH_CLASS = { same: "ok", listed: "info", close: "warn", check: "bad" };

// Every change made for PubMed, merged across lines: [{ lines, kind, ovid, pubmed, why }].
function translationChanges(history) {
  const rows = new Map();
  for (const line of history.lines) {
    for (const c of line.changes || []) {
      const k = `${c.kind}|${c.ovid}|${c.pubmed}`;
      if (!rows.has(k)) rows.set(k, { ...c, lines: [] });
      rows.get(k).lines.push(line.n);
    }
  }
  const order = { check: 0, close: 1, listed: 2, same: 3 };
  return [...rows.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.lines[0] - b.lines[0]);
}

function translationSection(history, finalQuery) {
  const changes = translationChanges(history);
  const tally = (kind) => changes.filter((c) => c.kind === kind).length;
  const summaryParts = [
    tally("listed") && `${tally("listed")} listed out`,
    tally("close") && `${tally("close")} close match${tally("close") === 1 ? "" : "es"}`,
    tally("check") && `${tally("check")} to check`,
  ].filter(Boolean);
  const finalCount = countFor(finalQuery);
  const countButton = h("button", { type: "button", class: "button secondary small", disabled: !finalQuery, onclick: () => countQueries([finalQuery], countButton) }, "Count results");
  return h(
    "details",
    {
      class: "translation",
      open: translationOpen,
      ontoggle: (e) => {
        translationOpen = e.target.open;
      },
    },
    h("summary", {}, "PubMed translation", summaryParts.length ? h("span", { class: "muted small", text: ` (${summaryParts.join(", ")})` }) : null),
    h(
      "div",
      { class: "translation-body" },
      h("p", { class: "small", text: "Ovid can't be searched from this page, so we translate your search into PubMed syntax to count the results. Both search MEDLINE, so the numbers are close but not identical." }),
      changes.length
        ? h(
            "div",
            { class: "table-wrap" },
            h(
              "table",
              { class: "report" },
              h(
                "thead",
                {},
                h("tr", {}, ["Line", "Ovid", "PubMed", "Match"].map((t) => h("th", { scope: "col", text: t }))),
              ),
              h(
                "tbody",
                {},
                changes.map((c) =>
                  h(
                    "tr",
                    {},
                    h("td", { text: c.lines.join(", ") }),
                    h("td", {}, h("code", { text: c.ovid })),
                    h("td", {}, c.pubmed ? h("code", { text: c.pubmed }) : null, c.why ? h("p", { class: "muted small", text: c.why }) : null),
                    h("td", {}, h("span", { class: `chip ${MATCH_CLASS[c.kind]}`, text: MATCH_LABELS[c.kind] })),
                  ),
                ),
              ),
            ),
          )
        : null,
      finalQuery ? h("pre", { class: "code-block", tabindex: "0", text: finalQuery }) : h("p", { class: "muted", text: "Choose an operator between each pair of concepts to see the full search." }),
      h(
        "div",
        { class: "block-actions" },
        countButton,
        finalQuery ? h("a", { class: "button link", href: pubmedUrl(finalQuery), target: "_blank", rel: "noopener" }, "Open in PubMed ↗") : null,
        finalCount ? h("p", { class: "count" }, h("strong", { text: finalCount.count.toLocaleString("en-GB") }), " PubMed records") : null,
      ),
      finalCount?.warnings?.length ? h("p", { class: "alert warning small", text: `PubMed: ${finalCount.warnings.join(" ")}` }) : null,
      h("p", { class: "hint", text: "Ovid MEDLINE usually finds slightly fewer, because PubMed also includes records that aren't in MEDLINE yet." }),
    ),
  );
}

const historyText = (history) => history.lines.map((l) => `${String(l.n).padEnd(3)}${l.text}`).join("\n");

function copyButton(getText) {
  const status = h("span", { class: "small muted", "aria-live": "polite" });
  const button = h(
    "button",
    {
      type: "button",
      class: "button secondary small",
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(getText());
          status.textContent = "Copied";
        } catch {
          status.textContent = "Copying didn't work. Select the search above and copy it instead.";
        }
      },
    },
    "Copy for Ovid",
  );
  return [button, status];
}

function stage5Ovid() {
  const list = concepts();
  const history = ovidHistory(list);
  const finalLine = history.lines.find((l) => l.n === history.finalLine);
  const finalQuery = finalLine?.pubmed || "";
  const feedbackButton = h("button", { type: "button", class: "button", onclick: () => submit() }, "Get feedback on my strategy");

  function submit() {
    const conceptQuery = (c) => history.byLine[history.conceptLine[c]] || "";
    submitFeedback(
      5,
      {
        question: state.question,
        database: "ovid",
        searchHistory: history.lines.map((l) => ({ line: l.n, search: l.text, count: countFor(l.pubmed)?.count, error: l.error || undefined })),
        blocks: list.map((c) => ({
          concept: c,
          query: history.lines.filter((l) => l.concept === c).map((l) => `${l.n} ${l.text}`).join(" | "),
          count: countFor(conceptQuery(c))?.count,
        })),
        operators: state.operators.slice(0, Math.max(0, list.length - 1)),
        strategy: historyText(history),
        pubmedTranslation: finalQuery,
        translationNotes: translationChanges(history)
          .filter((c) => c.kind !== "same")
          .map((c) => `Line ${c.lines.join(", ")}: ${c.ovid} → ${c.pubmed || "(not translated)"}. ${c.why}`.trim()),
        count: countFor(finalQuery)?.count,
        warnings: countFor(finalQuery)?.warnings || [],
      },
      feedbackButton,
    );
  }

  const cards = list.map((c, i) => {
    const card = ovidConceptCard(c, i, history);
    if (i === list.length - 1) return card;
    const select = h(
      "select",
      {
        id: `op-${i}`,
        onchange: (e) => {
          state.operators[i] = e.target.value;
          saveState();
          render();
        },
      },
      h("option", { value: "", text: "Choose…" }),
      OPERATORS.map((op) => h("option", { value: op, text: op, selected: state.operators[i] === op })),
    );
    const a = LETTERS[i] || String(i + 1);
    const b = LETTERS[i + 1] || String(i + 2);
    return [card, h("div", { class: "operator" }, h("label", { for: `op-${i}`, text: `Combine ${a} and ${b} with` }), select)];
  });

  const finalCount = countFor(finalQuery);
  const allButton = h(
    "button",
    { type: "button", class: "button secondary small", onclick: () => countQueries(history.lines.map((l) => l.pubmed), allButton) },
    "Count all lines",
  );

  return h(
    "section",
    { class: "card" },
    databaseSwitch(),
    stageHeader(5, [
      h("p", {}, "Here is your search as an Ovid search history, the way it will appear in Ovid. Each concept has its subject headings, a line of keywords, and a line joining them with ", h("code", { text: "or" }), ". You can edit the keyword lines."),
      h("p", { text: "Then choose how to join the concepts. The last line combines them." }),
      learnMore(
        "and, or and not in Ovid",
        h(
          "ul",
          {},
          h("li", {}, h("code", { text: "or" }), " finds records with any of the terms (more results): use it within a concept."),
          h("li", {}, h("code", { text: "and" }), " finds records with all of the concepts (fewer results): use it between concepts."),
          h("li", {}, h("code", { text: "not" }), " excludes records. Use it with great care, because it can remove relevant ones."),
          h("li", {}, h("code", { text: "exp Heading/" }), " searches an exploded subject heading. ", h("code", { text: ".ti,ab." }), " searches words in the title and abstract."),
          h("li", {}, "Line numbers stand for earlier searches: ", h("code", { text: "4 and 7" }), " combines lines 4 and 7, and ", h("code", { text: "or/1-3" }), " means 1 or 2 or 3."),
        ),
      ),
    ]),
    questionBox(),
    list.length === 0 ? h("p", { class: "alert warning", text: "Add your search concepts in stage 2 first." }) : h("div", { class: "blocks" }, cards),
    list.length
      ? h(
          "div",
          { class: "final-strategy", id: "final-strategy", "aria-live": "polite" },
          h("h2", { text: "Your Ovid search strategy" }),
          history.lines.length ? h("pre", { class: "code-block", tabindex: "0", text: historyText(history) }) : null,
          !history.finalLine && list.length > 1 ? h("p", { class: "muted", text: "Choose an operator between each pair of concepts to see the last line." }) : null,
          h(
            "div",
            { class: "block-actions" },
            history.lines.length ? copyButton(() => history.lines.map((l) => l.text).join("\n")) : null,
            history.lines.length ? allButton : null,
            finalCount ? h("p", { class: "count" }, h("strong", { text: finalCount.count.toLocaleString("en-GB") }), ` results for line ${history.finalLine} (counted in PubMed)`) : null,
          ),
          h("p", { class: "hint", text: "To run it in Ovid, start with an empty search history so the line numbers match, then paste the lines into Ovid's Multi-Line search." }),
          translationSection(history, finalQuery),
        )
      : null,
    list.length ? notesBox(5) : null,
    h(
      "div",
      { class: "actions" },
      list.length ? feedbackButton : null,
      h("button", { type: "button", class: "button secondary", onclick: () => downloadStrategy(list) }, "Download my search"),
    ),
    feedbackPanel(5),
    navButtons(5),
    startAgain(),
  );
}

function downloadStrategy(list) {
  const lines = [
    "Database Search Tutorial – search record",
    `Date: ${new Date().toLocaleString("en-GB")}`,
    "",
    "Research question:",
    state.question.trim(),
    "",
  ];
  const ovid = state.database === "ovid";
  lines.push(`Database: ${DATABASES[state.database].name}`, "");
  list.forEach((c, i) => {
    const m = meshFor(c);
    lines.push(`Concept ${i + 1}: ${c}`);
    lines.push(`  Alternative terms: ${synonymsFor(c).join("; ") || "none"}`);
    const headings = m.selected.map((s) => `${s.heading} (${s.ui}${s.explode === false ? ", not exploded" : ", exploded"})`);
    lines.push(`  MeSH: ${headings.join("; ") || (m.noHeading ? "no suitable heading" : "none chosen")}`);
    if (!ovid) {
      const q = blockFor(c).query;
      const n = state.blockCounts[c]?.query === q ? ` – ${state.blockCounts[c].count} results` : "";
      lines.push(`  #${i + 1} ${q}${n}`);
    }
    lines.push("");
  });
  let strategy;
  let count;
  if (ovid) {
    const history = ovidHistory(list);
    strategy = history.byLine[history.finalLine] || "";
    lines.push("Ovid search history:");
    for (const l of history.lines) {
      const n = countFor(l.pubmed);
      lines.push(`  ${String(l.n).padEnd(3)}${l.text}${n ? `   (${n.count} results in PubMed)` : ""}`);
    }
    lines.push("", "Translated for PubMed:", strategy || "(not combined yet)");
    count = countFor(strategy)?.count;
  } else {
    strategy = finalStrategy(list);
    lines.push("Final PubMed strategy:", strategy || "(not combined yet)");
    count = state.finalCount?.query === strategy ? state.finalCount.count : undefined;
  }
  if (count !== undefined) lines.push(`Results in PubMed: ${count}`);
  const notes = STAGES.filter((s) => (state.notes[s.n] || "").trim()).map((s) => `  ${s.short}: ${state.notes[s.n].trim()}`);
  if (notes.length) lines.push("", "Notes for the tutor:", ...notes);
  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
  const a = h("a", { href: URL.createObjectURL(blob), download: "search-strategy.txt" });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------- Connection ----------

function renderConnection() {
  const pill = $("connection-button");
  const label = $("connection-label");
  pill.dataset.mode = connection.mode;
  label.textContent =
    connection.mode === "live"
      ? `Live AI tutor · ${connection.provider === "copilot" ? "Copilot" : connection.provider}`
      : connection.mode === "no-ai"
        ? "Example feedback · AI not set up yet"
        : "Offline demo · example feedback";
}

// ---------- Waking the tutor ----------

let wake = { status: "idle" }; // "idle" | "waking" | "error"

const WAKE_STATES = {
  Shutdown: "asleep",
  ShuttingDown: "just going to sleep",
  Starting: "starting up",
  Queued: "starting up",
  Provisioning: "starting up",
  Available: "nearly ready",
};

function renderWakeBanner() {
  const slot = $("wake-banner");
  if (wake.status !== "waking" && !canWake()) {
    slot.replaceChildren();
    return;
  }
  if (wake.status === "waking") {
    slot.replaceChildren(
      h(
        "div",
        { class: "wake-banner waking", role: "status" },
        h("p", { class: "wake-title" }, "Waking the tutor… ", h("span", { class: "muted", text: `${wake.seconds || 0} s` })),
        h("p", {
          text: `The tutor's computer is ${WAKE_STATES[wake.state] || "starting up"}. This usually takes 1–2 minutes. You can carry on working; feedback switches to the AI tutor when it's ready.`,
        }),
        // Running for a while but still not answering usually means its port is still Private.
        wake.state === "Available" && wake.seconds > 90
          ? h("p", {
              class: "wake-hint",
              text: "This is taking longer than usual. The tutor is running but can't be reached yet, which usually means its connection is still set to private. If it doesn't connect soon, please let the person running the tutor know.",
            })
          : null,
      ),
    );
    return;
  }
  const passcode = h("input", { type: "password", id: "wake-passcode", autocomplete: "off", value: connection.passcode });
  slot.replaceChildren(
    h(
      "div",
      { class: "wake-banner", role: "region", "aria-label": "AI tutor status" },
      h(
        "div",
        { class: "wake-text" },
        h("p", { class: "wake-title", text: "The AI tutor is asleep" }),
        h("p", { text: "Wake it up to get AI feedback. It takes about 1–2 minutes, and until then you'll see example feedback." }),
        wake.error ? h("p", { class: "field-error", role: "alert", text: wake.error }) : null,
        wake.needPasscode ? h("div", { class: "wake-passcode" }, h("label", { for: "wake-passcode", text: "Passcode" }), passcode) : null,
      ),
      h(
        "button",
        {
          type: "button",
          class: "button",
          onclick: () => {
            if (wake.needPasscode) setPasscode(passcode.value.trim());
            startWake();
          },
        },
        "Wake the tutor",
      ),
    ),
  );
}

async function startWake() {
  const startedAt = Date.now();
  wake = { status: "waking", seconds: 0, state: "Starting" };
  renderWakeBanner();
  // Tick every second so people can see something is happening.
  const ticker = setInterval(() => {
    wake.seconds = Math.round((Date.now() - startedAt) / 1000);
    renderWakeBanner();
  }, 1000);
  try {
    await wakeTutor((_seconds, state) => {
      wake.state = state;
      renderWakeBanner();
    });
    wake = { status: "idle" };
  } catch (err) {
    wake = { status: "error", error: err.message, needPasscode: err.status === 401 };
  } finally {
    clearInterval(ticker);
  }
  renderConnection();
  renderWakeBanner();
}

function openConnection() {
  const dialog = $("connection-dialog");
  $("backend-input").value = connection.base;
  $("passcode-input").value = connection.passcode;
  $("connection-status").textContent =
    connection.mode === "live"
      ? `Connected to the live tutor (${connection.provider}${connection.model ? `, ${connection.model}` : ""}).${connection.passcodeRequired ? " This tutor needs a passcode." : ""}`
      : connection.mode === "no-ai"
        ? `The server is running but its AI isn't ready. ${connection.message}`
        : connection.message || "You're using the offline demo. Feedback is example text, not AI. MeSH and PubMed look-ups still use live data where possible.";
  dialog.showModal();
}

function setupConnectionDialog() {
  $("connection-button").addEventListener("click", openConnection);
  $("connection-cancel").addEventListener("click", () => $("connection-dialog").close());
  $("connection-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const save = $("connection-save");
    save.disabled = true;
    save.textContent = "Connecting…";
    await connectTo($("backend-input").value, $("passcode-input").value);
    save.disabled = false;
    save.textContent = "Connect";
    renderConnection();
    renderWakeBanner();
    if (connection.mode === "live") $("connection-dialog").close();
    else openConnection();
  });
}

// ---------- Boot ----------

const RENDERERS = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5 };

function render() {
  renderStepper();
  renderWakeBanner();
  $("stage").replaceChildren(RENDERERS[state.stage]());
  document.title = `${STAGES[state.stage - 1].title} – Database Search Tutorial`;
}

setupConnectionDialog();
render();
autoConnect().then(() => {
  renderConnection();
  renderWakeBanner();
});
