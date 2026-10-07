// Database Search Tutorial – five-stage interactive tutorial.
// Plain JavaScript modules, no build step, so it runs on GitHub Pages and in a Codespace unchanged.

import { autoConnect, connectTo, connection, lookupMesh, pubmedCount, requestFeedback } from "./api.js";
import { buildBlock, checkSyntax, combineBlocks, OPERATORS, parseTerms } from "./shared/strategy.js";
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
const STATE_KEY = "dst-state-v1";

// ---------- State ----------

function freshState() {
  return {
    stage: 1,
    reached: 1,
    question: "",
    concepts: [""],
    synonyms: {}, // concept -> text
    mesh: {}, // concept -> { term, results, selected, noHeading }
    blocks: {}, // concept -> { query, edited }
    operators: [],
    blockCounts: {}, // concept -> { query, count }
    finalCount: null, // { query, count, warnings, queryTranslation }
    feedback: {}, // stage -> { feedback, source, notice, attempt, provider, model }
    attempts: {}, // stage -> number
  };
}

let state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    return saved ? { ...freshState(), ...saved } : freshState();
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
      ? `Live AI tutor${entry.provider ? ` · ${entry.provider === "copilot" ? "GitHub Copilot" : entry.provider === "github-models" ? "GitHub Models" : entry.provider}` : ""}${entry.model ? ` (${entry.model})` : ""}`
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
                h("div", {}, h("p", { class: "item-label", text: i.label }), h("p", { class: "item-comment", text: i.comment })),
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

async function submitFeedback(n, data, button) {
  const attempt = (state.attempts[n] || 0) + 1;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = connection.mode === "live" ? "The tutor is reading your work…" : "Checking…";
  button.setAttribute("aria-busy", "true");
  try {
    const result = await requestFeedback(n, data, attempt);
    state.attempts[n] = attempt;
    state.feedback[n] = { ...result, attempt };
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

  function submit() {
    submitFeedback(3, { question: state.question, concepts: list.map((c) => ({ concept: c, synonyms: synonymsFor(c) })) }, button);
  }

  return h(
    "section",
    { class: "card" },
    stageHeader(3, [
      h("p", { text: "Authors describe the same idea in many different ways. To find all the relevant papers, list the other words they might use for each concept." }),
      learnMore(
        "What kinds of alternative terms?",
        h(
          "ul",
          {},
          h("li", { text: "Synonyms and lay terms: heart attack, myocardial infarction" }),
          h("li", { text: "Abbreviations: COPD, chronic obstructive pulmonary disease" }),
          h("li", { text: "UK and US spellings: paediatric, pediatric" }),
          h("li", { text: "Truncation for word endings: child* finds child, children, childhood" }),
          h("li", { text: "Phrases in quotation marks: \"physical activity\"" }),
          h("li", { text: "Specific examples within a group, e.g. individual drug names" }),
        ),
      ),
    ]),
    questionBox(),
    list.length === 0
      ? h("p", { class: "alert warning", text: "Add your search concepts in stage 2 first." })
      : h(
          "div",
          { class: "concept-cards" },
          list.map((c, i) =>
            h(
              "div",
              { class: "concept-card" },
              h("label", { for: `syn-${i}`, class: "field-label" }, "Alternative terms for ", h("strong", { text: c })),
              h("textarea", {
                id: `syn-${i}`,
                rows: 5,
                value: state.synonyms[c] || "",
                placeholder: "One term per line",
                oninput: (e) => {
                  state.synonyms[c] = e.target.value;
                  saveState();
                },
              }),
            ),
          ),
        ),
    h("div", { class: "actions" }, list.length ? button : null),
    feedbackPanel(3),
    navButtons(3),
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
      ? h("p", { class: "selected-list" }, h("strong", { text: "Chosen: " }), m.selected.map((s) => h("span", { class: "tag", text: s.heading })))
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

function stage4() {
  const list = concepts();
  const button = h("button", { type: "button", class: "button", onclick: () => submit() }, "Get feedback on my headings");

  function submit() {
    submitFeedback(
      4,
      {
        question: state.question,
        concepts: list.map((c) => ({ concept: c, headings: meshFor(c).selected, noHeading: meshFor(c).noHeading })),
      },
      button,
    );
  }

  return h(
    "section",
    { class: "card" },
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
          h("li", { text: "Headings sit in hierarchical trees. PubMed “explodes” a heading by default, so narrower headings beneath it are included too." }),
          h("li", { text: "Not every concept has a heading, and the newest papers aren't indexed yet, so keep using your keywords as well." }),
          h("li", { text: "Other databases use their own vocabularies (Emtree in Embase, CINAHL Headings in CINAHL)." }),
        ),
      ),
    ]),
    list.length === 0 ? h("p", { class: "alert warning", text: "Add your search concepts in stage 2 first." }) : h("div", { class: "concept-cards" }, list.map(meshCard)),
    h("div", { class: "actions" }, list.length ? button : null),
    feedbackPanel(4),
    navButtons(4),
  );
}

// ---------- Stage 5: Boolean strategy ----------

function generatedBlock(c) {
  return buildBlock({ concept: c, synonyms: synonymsFor(c), meshHeadings: meshFor(c).selected.map((s) => s.heading) });
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
  const list = concepts();
  const feedbackButton = h("button", { type: "button", class: "button", onclick: () => submit() }, "Get feedback on my strategy");

  function submit() {
    const strategy = finalStrategy(list);
    submitFeedback(
      5,
      {
        question: state.question,
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
    h(
      "div",
      { class: "actions" },
      list.length ? feedbackButton : null,
      h("button", { type: "button", class: "button secondary", onclick: () => downloadStrategy(list) }, "Download my search"),
    ),
    feedbackPanel(5),
    navButtons(5),
    h(
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
    ),
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
  list.forEach((c, i) => {
    const m = meshFor(c);
    lines.push(`Concept ${i + 1}: ${c}`);
    lines.push(`  Alternative terms: ${synonymsFor(c).join("; ") || "none"}`);
    lines.push(`  MeSH: ${m.selected.map((s) => `${s.heading} (${s.ui})`).join("; ") || (m.noHeading ? "no suitable heading" : "none chosen")}`);
    const q = blockFor(c).query;
    const n = state.blockCounts[c]?.query === q ? ` – ${state.blockCounts[c].count} results` : "";
    lines.push(`  #${i + 1} ${q}${n}`);
    lines.push("");
  });
  const strategy = finalStrategy(list);
  lines.push("Final PubMed strategy:", strategy || "(not combined yet)");
  if (state.finalCount?.query === strategy) lines.push(`Results: ${state.finalCount.count}`);
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
      ? `Live AI tutor · ${connection.provider === "copilot" ? "Copilot" : connection.provider === "github-models" ? "GitHub Models" : connection.provider}`
      : connection.mode === "no-ai"
        ? "Server connected · AI not ready"
        : "Offline demo · example feedback";
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
    if (connection.mode === "live") $("connection-dialog").close();
    else openConnection();
  });
}

// ---------- Boot ----------

const RENDERERS = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5 };

function render() {
  renderStepper();
  $("stage").replaceChildren(RENDERERS[state.stage]());
  document.title = `${STAGES[state.stage - 1].title} – Database Search Tutorial`;
}

setupConnectionDialog();
render();
autoConnect().then(renderConnection);
