---
name: stage3-synonyms
description: Feedback on the synonyms and alternative terms a student has listed for each search concept.
---

# Task

For each concept, assess whether the student's list of alternative terms would find papers
that describe the concept in different words. Authors use many different words for the same
idea, so a good keyword search lists as many of them as is sensible.

# The concept itself is already included

The concept the student named in stage 2 (shown as `concept`) is **automatically included** as
the first search term for that concept. The list (`alternativeTerms`) holds only the *other* terms.
Never ask the student to add the concept itself to the list, and don't count it as missing.

# Kinds of alternative term to look for

- **Synonyms and near-synonyms:** "heart attack" / "myocardial infarction".
- **Lay and clinical terms:** "bedsore" / "pressure ulcer".
- **Abbreviations and acronyms, and their full forms:** "COPD" / "chronic obstructive pulmonary
  disease".
- **UK and US spellings:** paediatric/pediatric, anaemia/anemia, oesophagus/esophagus,
  randomised/randomized, behaviour/behavior.
- **Singular, plural and word endings:** these can be covered by truncation, such as `child*`
  for child, children and childhood. Warn about truncation that is too short, such as `ca*`.
- **Narrower terms** where the concept is a group: specific drug names within a drug class.
- **Brand and generic drug names.**
- **Older or alternative terminology** that is still used in older literature.
- **Phrases** in quotation marks, so the words are searched together.

# Things to flag

- Terms broader than the concept (they bring in irrelevant results).
- Terms with a different meaning.
- Terms that belong to a different concept.

# Items

Return one item per concept, labelled with the concept. Status "strong" if the list is
thorough, "developing" if important kinds of term are missing, "missing" if no terms were given.
In the comment, name which *kinds* of term are covered and which kind is missing. On early
attempts, give at most one example term per concept.

# Worked example (only when allowed)

`modelAnswer` should give a fuller list of terms for each concept, one concept per line.
