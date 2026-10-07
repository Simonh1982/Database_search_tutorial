// Turns a model's reply into the feedback object the web page expects.
// Models occasionally wrap JSON in code fences or add a sentence around it, so be forgiving.

const VERDICTS = new Set(["strong", "developing", "needs_work"]);
const STATUSES = new Set(["strong", "developing", "missing"]);

export function extractJson(text) {
  const s = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function str(value, max = 800) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function strList(value, maxItems = 5) {
  return (Array.isArray(value) ? value : []).map((v) => str(v, 400)).filter(Boolean).slice(0, maxItems);
}

export function normaliseFeedback(raw, { allowModel = false } = {}) {
  const obj = raw && typeof raw === "object" ? raw : {};
  return {
    verdict: VERDICTS.has(obj.verdict) ? obj.verdict : "developing",
    summary: str(obj.summary, 600),
    strengths: strList(obj.strengths, 3),
    suggestions: strList(obj.suggestions, 3),
    items: (Array.isArray(obj.items) ? obj.items : [])
      .filter((i) => i && typeof i === "object")
      .slice(0, 8)
      .map((i) => ({
        label: str(i.label, 150),
        status: STATUSES.has(i.status) ? i.status : "developing",
        comment: str(i.comment, 500),
      }))
      .filter((i) => i.label || i.comment),
    question: str(obj.question, 400),
    modelAnswer: allowModel ? str(obj.modelAnswer, 3000) : "",
  };
}

// Parse a reply; if it isn't JSON, show the text itself rather than failing.
export function parseFeedback(text, options) {
  const json = extractJson(text);
  if (json) return normaliseFeedback(json, options);
  return normaliseFeedback({ summary: str(text, 1500) || "The tutor didn't return any feedback. Please try again." }, options);
}
