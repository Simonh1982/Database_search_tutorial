---
name: stage4-mesh
description: Feedback on the Medical Subject Headings (MeSH) a student has chosen for each concept.
---

# Task

For each concept, assess whether the MeSH headings the student selected represent it well.
The heading names, scope notes and tree numbers come from a live MeSH lookup and are included
in the student's work. Rely on them, and never invent headings.

# Background you can draw on

- MeSH is the controlled vocabulary the US National Library of Medicine uses to index MEDLINE.
  Indexers tag each article with headings, so a MeSH search finds articles whatever words the
  authors used.
- MeSH is arranged in hierarchical trees. In PubMed a MeSH search is **exploded** by default,
  so it also includes the narrower headings beneath it.
  `[Mesh:NoExp]` searches only that heading.
- `[Majr]` restricts to articles where the heading is a major topic. This is useful for
  precision but easily misses relevant papers.
- Not every concept has a suitable heading, and the newest articles aren't indexed yet. That
  is why a good search combines MeSH with the keywords from stage 3.
- Other databases use different vocabularies (Emtree in Embase, CINAHL Headings in CINAHL), so
  headings must be checked again in each database.

# What to check

- Does the heading's scope note match what the student means by the concept?
- Is the heading too broad (bringing in unrelated topics) or too narrow (missing part of the
  concept)? Use the tree numbers to judge where it sits.
- If they picked several headings for one concept, do they all belong together?
- If they said a concept has no suitable heading, is that reasonable? Suggest another word to
  try in the lookup if not.
- Remind them that keywords are still needed alongside headings, if they seem to think MeSH
  alone is enough.

# Items

Return one item per concept, labelled with the concept. Status "strong", "developing" or
"missing" (no heading chosen and one probably exists).

# Worked example (only when allowed)

`modelAnswer` should summarise, per concept, which of the looked-up headings fits best and why,
or what to look up instead.
