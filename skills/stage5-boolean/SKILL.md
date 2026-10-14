---
name: stage5-boolean
description: Feedback on a student's complete Boolean search strategy (Ovid MEDLINE or PubMed) and its result counts.
---

# Task

Assess the student's search strategy: the concept blocks, the operators they chose to combine
them, and the live PubMed result counts included in their work.

# Principles

- **OR within a concept:** a block combines the MeSH heading(s) and keywords for one idea with
  OR. This broadens the search.
- **AND between concepts:** this narrows the search to papers about all the concepts together.
  Using OR between different concepts is the most common mistake. It usually produces a
  very large result count.
- **OR between two blocks is correct when they are alternatives for the same part of the
  question.** For example, triptans OR NSAIDs, when papers about either treatment are relevant.
  Check the student's notes and earlier choices before calling an OR a mistake. The app puts
  blocks joined by OR in brackets automatically, so `#1 AND #2 OR #3` is searched as
  `#1 AND (#2 OR #3)`.
- **NOT with great care:** it can exclude relevant papers. For example, `NOT animals[mh]` also
  removes studies of both humans and animals. The safer pattern is
  `NOT (animals[mh] NOT humans[mh])`.
- **Brackets** keep each OR block together. Quotation marks keep phrases together, and
  truncation (`*`) covers word endings.
- **Field tags:** `[Mesh]` for subject headings, `[tiab]` for words in the title or abstract.

# Ovid MEDLINE search histories

When `database` is "Ovid MEDLINE", the work is a numbered Ovid search history (`searchHistory`),
as the student will build it in Ovid:

- a line for each subject heading (`exp Heading/`, or `Heading/` when not exploded);
- a keyword line searched in titles and abstracts, ending `.ti,ab.`;
- a line combining each concept's lines with `or` (e.g. `5 or 6`, or `or/1-3`);
- a final line combining the concepts by line number (e.g. `4 and 7 and 10`). Concepts joined
  with `or` get their own `or` line first.

The app builds these lines. The student can edit the keyword lines and chooses the operators.
Discuss the strategy in Ovid syntax and refer to line numbers.

Ovid can't be searched from the app, so each line is translated into PubMed syntax and counted
in PubMed (`pubmedTranslation`). The counts are close to Ovid's, but not identical.
`translationNotes` lists where PubMed had to differ, e.g. Ovid's one-letter wildcards listed as
separate spellings. These are not the student's mistakes: mention one only if it explains a
surprising count. A line with a `translationProblem` usually has an Ovid syntax error; help the
student fix it.

# Using the result counts

- Hundreds of thousands of results: probably too broad. Check for OR used between concepts, or a
  very general block.
- Zero or very few results: probably too narrow. Check for too many concepts combined with AND,
  spelling mistakes, missing synonyms, or a NOT that removes too much.
- Compare the block counts. A block with a tiny count may be missing terms. A block with an
  enormous count may contain a term that is too general.
- There is no single "right" number. The aim depends on the purpose: a quick search for a few
  key papers, or a sensitive search for a systematic review.

# Next steps worth mentioning (briefly, when the strategy is sound)

- Check that the search finds two or three papers they already know are relevant.
- Translate the strategy for other databases (Embase, CINAHL), adapting the subject headings.
- Record the strategy and date so it can be reported and repeated.
- Book a session with the library for help with systematic searching.

# Items

Return one item per concept block (labelled with the concept), and one final item labelled
"Combining the blocks" assessing the operators.

# Worked example (only when allowed)

`modelAnswer` should be a corrected version of the student's final strategy in the syntax of
their database (a numbered Ovid search history for Ovid MEDLINE), built only from their own
terms and headings.
