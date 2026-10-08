// Keeps the tutor consistent between attempts.
// The browser sends the student's earlier attempts (work + feedback). From these we:
//   - show the tutor what it said before, at this stage and at earlier stages
//   - work out, in code, which items the student has changed since the last attempt
//   - keep items the tutor approved, and the student hasn't changed, approved

const MAX_PREVIOUS_ATTEMPTS = 3;
const STATUSES = new Set(["strong", "developing", "missing"]);

const key = (label) => String(label ?? "").trim().toLowerCase();

function clip(value, max) {
  const s = String(value ?? "").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function compactFeedback(f = {}) {
  return {
    verdict: clip(f.verdict, 20),
    summary: clip(f.summary, 500),
    items: (Array.isArray(f.items) ? f.items : []).slice(0, 8).map((i) => ({
      label: clip(i?.label, 150),
      status: STATUSES.has(i?.status) ? i.status : "developing",
      comment: clip(i?.comment, 400),
    })),
    suggestions: (Array.isArray(f.suggestions) ? f.suggestions : []).slice(0, 3).map((s) => clip(s, 300)),
  };
}

// The student's previous attempts at this stage, oldest first, already passed through sanitiseWork.
export function previousAttempts(stage, history, sanitiseWork) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => h && typeof h === "object" && h.feedback)
    .slice(-MAX_PREVIOUS_ATTEMPTS)
    .map((h) => ({
      attempt: Number.parseInt(h.attempt, 10) || 0,
      work: sanitiseWork(stage, h.work || {}),
      feedback: compactFeedback(h.feedback),
    }));
}

// The latest feedback from each earlier stage, so advice stays consistent across the tutorial.
export function earlierStages(stage, earlier) {
  return (Array.isArray(earlier) ? earlier : [])
    .filter((e) => e && Number(e.stage) >= 1 && Number(e.stage) < Number(stage) && e.feedback)
    .slice(0, 4)
    .map((e) => {
      const f = compactFeedback(e.feedback);
      const notes = clip(e.notes, 400);
      return {
        stage: Number(e.stage),
        summary: f.summary,
        items: f.items.map(({ label, status }) => ({ label, status })),
        ...(notes ? { studentNotes: notes } : {}),
      };
    });
}

// What each feedback item refers to in the (sanitised) work, so changes can be detected.
// Labels match the item labels the stage skills ask the tutor to use.
export function itemValues(stage, work = {}) {
  const values = new Map();
  const concepts = Array.isArray(work.concepts) ? work.concepts : [];
  switch (Number(stage)) {
    case 2:
      concepts.forEach((c) => values.set(key(c), key(c)));
      break;
    case 3:
      concepts.forEach((c) => values.set(key(c.concept), [...(c.alternativeTerms || [])].map(key).sort().join("|")));
      break;
    case 4:
      concepts.forEach((c) =>
        values.set(key(c.concept), `${(c.selectedHeadings || []).map((h) => h.meshId).sort().join("|")}|none:${Boolean(c.studentSaysNoSuitableHeading)}`),
      );
      break;
    case 5:
      (work.blocks || []).forEach((b) => values.set(key(b.concept), String(b.searchLine || "").trim()));
      values.set(key("Combining the blocks"), (work.operatorsBetweenBlocks || []).join(" "));
      break;
    default:
      break; // Stage 1 is one question; it is compared as a whole.
  }
  return values;
}

export function sameWork(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Items the tutor called "strong" last time whose part of the work hasn't changed since.
export function approvedAndUnchanged(stage, work, previous) {
  const last = previous.at(-1);
  if (!last) return [];
  const now = itemValues(stage, work);
  const before = itemValues(stage, last.work);
  return last.feedback.items.filter((item) => {
    const k = key(item.label);
    return item.status === "strong" && now.has(k) && before.has(k) && now.get(k) === before.get(k);
  });
}

// Keep the overall verdict in line with the items: if every item is good, so is the work.
export function alignVerdict(feedback) {
  const items = feedback.items || [];
  if (items.length && items.every((i) => i.status === "strong")) return { ...feedback, verdict: "strong" };
  return feedback;
}

// Enforce consistency on the tutor's reply: approved, unchanged items stay approved with the
// same comment, even if the model wavers. Missing ones are added back.
export function applyConsistency(feedback, approved) {
  if (!approved.length) return feedback;
  const byKey = new Map(approved.map((i) => [key(i.label), i]));
  const items = feedback.items.map((item) => {
    const locked = byKey.get(key(item.label));
    if (!locked) return item;
    byKey.delete(key(item.label));
    return { label: item.label, status: "strong", comment: item.status === "strong" ? item.comment : locked.comment, unchanged: true };
  });
  for (const locked of byKey.values()) items.push({ label: locked.label, status: "strong", comment: locked.comment, unchanged: true });
  return { ...feedback, items };
}
