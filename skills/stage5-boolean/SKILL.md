---
name: stage5-boolean
description: Feedback on a student's complete Boolean search strategy and its PubMed result counts.
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
- **NOT with great care:** it can exclude relevant papers. For example, `NOT animals[mh]` also
  removes studies of both humans and animals. The safer pattern is
  `NOT (animals[mh] NOT humans[mh])`.
- **Brackets** keep each OR block together. Quotation marks keep phrases together, and
  truncation (`*`) covers word endings.
- **Field tags:** `[Mesh]` for subject headings, `[tiab]` for words in the title or abstract.

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

`modelAnswer` should be a corrected version of the student's final strategy in PubMed syntax,
built only from their own terms and headings.
