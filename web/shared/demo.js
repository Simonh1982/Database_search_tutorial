// Rule-based example feedback for the offline demo (no AI involved).
// It uses simple checks so the tutorial can be explored when no live tutor is connected.

const GENERIC_WORDS = ["effect", "effects", "impact", "role", "treatment", "patients", "people", "outcome", "outcomes", "relationship", "management", "study", "studies", "effectiveness", "efficacy"];
const DESIGN_WORDS = ["randomised", "randomized", "trial", "rct", "systematic review", "meta-analysis", "cohort", "case control", "qualitative"];

const words = (s) => String(s || "").toLowerCase();

function stage1(data) {
  const q = words(data.question);
  const hasComparison = /\b(compared|versus|vs\.?|than|placebo|usual care)\b/.test(q);
  const tooShort = q.split(/\s+/).filter(Boolean).length < 8;
  return {
    verdict: tooShort ? "needs_work" : "developing",
    summary: tooShort
      ? "Your question looks quite short. Most focused questions name who, what is done, and what is measured."
      : "Check your question against each part of PICO below.",
    strengths: q.includes("?") ? ["You've written it as a question, which keeps it focused."] : [],
    suggestions: [
      "Make sure the population is specific: condition, age group or setting.",
      "Name a measurable outcome rather than 'effective' or 'better'.",
    ],
    items: [
      { label: "Population (P)", status: "developing", comment: "Who is the question about? Is the group specific enough?" },
      { label: "Intervention (I)", status: "developing", comment: "What treatment, test or exposure are you interested in?" },
      {
        label: "Comparison (C)",
        status: hasComparison ? "strong" : "developing",
        comment: hasComparison ? "Your question appears to include a comparison." : "A comparison is optional. Is there an alternative you want to compare against?",
      },
      { label: "Outcome (O)", status: "developing", comment: "What will be measured to show whether it works?" },
    ],
    question: "If you found the perfect paper, what would its title say?",
    modelAnswer: "",
  };
}

function stage2(data) {
  const concepts = (data.concepts || []).filter(Boolean);
  const items = concepts.map((c) => {
    const w = words(c);
    const generic = GENERIC_WORDS.filter((g) => new RegExp(`\\b${g}\\b`).test(w));
    const design = DESIGN_WORDS.filter((d) => w.includes(d));
    if (design.length) return { label: c, status: "developing", comment: `"${design[0]}" describes a study design. Design limits are usually added at the end, not searched as a concept.` };
    if (generic.length) return { label: c, status: "developing", comment: `"${generic[0]}" is a generic word that authors rarely use consistently. Could you remove it?` };
    if (/\b(with|and|in)\b/.test(w)) return { label: c, status: "developing", comment: "This may contain two ideas. Could it be split into separate concepts?" };
    return { label: c, status: "strong", comment: "This looks like a searchable concept." };
  });
  const tooMany = concepts.length > 4;
  return {
    verdict: items.every((i) => i.status === "strong") && !tooMany ? "strong" : "developing",
    summary: tooMany ? "Most searches use two to four concepts. Do you need all of them?" : "Here is a quick check of each concept.",
    strengths: items.some((i) => i.status === "strong") ? ["Some of your concepts are already clear, single ideas."] : [],
    suggestions: ["The comparison is often left out of the search, because it is described inconsistently in abstracts."],
    items,
    question: "Which parts of your PICO are essential for a paper to be relevant?",
    modelAnswer: "",
  };
}

function stage3(data) {
  const items = (data.concepts || []).map((c) => {
    const n = (c.synonyms || []).length;
    const truncated = (c.synonyms || []).some((s) => s.includes("*"));
    if (n === 0) return { label: c.concept, status: "missing", comment: "No alternative terms yet." };
    return {
      label: c.concept,
      status: n >= 4 ? "strong" : "developing",
      comment: `${n} term${n === 1 ? "" : "s"} listed${truncated ? ", including truncation" : ""}. Have you checked abbreviations and UK/US spellings?`,
    };
  });
  return {
    verdict: items.every((i) => i.status === "strong") ? "strong" : "developing",
    summary: "Authors describe the same idea in many different ways. The more variations you cover, the fewer relevant papers you miss.",
    strengths: [],
    suggestions: [
      "Add abbreviations and their full forms (e.g. COPD and chronic obstructive pulmonary disease).",
      "Include UK and US spellings (paediatric/pediatric).",
      "Use truncation (child*) to cover word endings.",
    ],
    items,
    question: "What words would a patient use for this, compared with a clinician?",
    modelAnswer: "",
  };
}

function stage4(data) {
  const items = (data.concepts || []).map((c) => {
    const h = c.headings || [];
    if (h.length) return { label: c.concept, status: "strong", comment: `You chose ${h.map((x) => `"${x.heading}"`).join(", ")}. Check the scope note matches what you mean.` };
    if (c.noHeading) return { label: c.concept, status: "developing", comment: "You said there's no suitable heading. Try looking up a synonym from stage 3 before deciding." };
    return { label: c.concept, status: "missing", comment: "No heading chosen yet. Look up the concept or one of its synonyms." };
  });
  return {
    verdict: items.every((i) => i.status === "strong") ? "strong" : "developing",
    summary: "MeSH headings find papers whatever words the authors used. Keep your keywords too, because new papers aren't indexed yet.",
    strengths: [],
    suggestions: ["Read each heading's scope note and look at where it sits in the tree to check it isn't too broad or narrow."],
    items,
    question: "Would the narrower headings under your choice also be relevant?",
    modelAnswer: "",
  };
}

function stage5(data) {
  const ops = data.operators || [];
  const items = (data.blocks || []).map((b) => ({
    label: b.concept,
    status: Number.isFinite(b.count) && b.count === 0 ? "developing" : "strong",
    comment: Number.isFinite(b.count) ? `This block finds ${b.count.toLocaleString("en-GB")} records.` : "Run this block to see how many records it finds.",
  }));
  const usesOr = ops.includes("OR");
  const usesNot = ops.includes("NOT");
  items.push({
    label: "Combining the blocks",
    status: usesOr ? "developing" : "strong",
    comment: usesOr
      ? "You've used OR between different concepts. That finds papers about any one of them, rather than all of them together."
      : usesNot
        ? "Be careful with NOT: it can remove relevant papers that mention the excluded idea in passing."
        : "AND between concepts narrows the search to papers about all of them.",
  });
  const count = data.count;
  let summary = "Run the full strategy to see how many records it finds.";
  if (Number.isFinite(count)) {
    summary = count > 200000 ? `Your search finds ${count.toLocaleString("en-GB")} records, which is very broad.` : count === 0 ? "Your search finds no records, so something is too narrow." : `Your search finds ${count.toLocaleString("en-GB")} records.`;
  }
  return {
    verdict: usesOr || count === 0 ? "developing" : "strong",
    summary,
    strengths: [],
    suggestions: ["Check that the search finds two or three papers you already know are relevant."],
    items,
    question: "Is this search for a quick answer, or does it need to be sensitive enough for a systematic review?",
    modelAnswer: "",
  };
}

const BUILDERS = { 1: stage1, 2: stage2, 3: stage3, 4: stage4, 5: stage5 };

export function demoFeedback(stage, data = {}) {
  const build = BUILDERS[Number(stage)];
  if (!build) throw new Error(`Unknown stage: ${stage}`);
  return build(data);
}
