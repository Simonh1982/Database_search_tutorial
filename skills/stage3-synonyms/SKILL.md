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
- **Phrases:** the student just types the words. The app keeps them together as a phrase.
- **Proximity** where authors put words in different orders or add words between them, e.g.
  "migraine attacks" and "attacks of migraine".

# Syntax for the student's database

Comment on syntax in the database the student is using (`database`). The app already checks
each term as it's typed, and adds the field (`.ti,ab.` in Ovid, `[tiab]` in PubMed) and phrase
quotation marks in stage 5. So never ask the student to add field tags or quotation marks to
ordinary phrases.

**Ovid MEDLINE**
- `*` or `$`: truncation, e.g. `migrain*` finds migraine, migraines, migrainous.
- `*1`, `$1`, `*2`…: limited truncation, e.g. `boy*1` finds boy and boys but not boyfriend.
- `#`: exactly one letter, e.g. `wom#n`. `?`: one letter or none, e.g. `p?ediatric*` finds
  paediatric and pediatric (with truncation).
- `adjN`: both words in either order with up to N−1 words between, e.g. `migraine adj3 attack*`.
  Plain `adj` means next to each other, in the order typed.
- Truncation and wildcards can't be the first character.

**PubMed**
- `*`: truncation, which needs at least 4 letters before it (`boy*` doesn't work; list boy, boys).
- `*` can also go inside a word, with at least 4 letters before it, e.g. `randomi*ed`.
- No one-letter wildcard and no limited truncation: list the spellings or forms instead.
- Proximity: `"word1 word2"[tiab:~N]`, up to N words between, in either order. It only works in
  titles and abstracts, and can't be combined with `*`.
- Truncation switches off PubMed's automatic mapping to MeSH, which is fine because stage 4 adds
  headings.

# Things to flag

- Terms broader than the concept (they bring in irrelevant results).
- Terms with a different meaning.
- Terms that belong to a different concept.
- Truncation that is too short or cuts off at the wrong point (e.g. `migraine*` misses
  "migrainous"; `migrain*` finds it).
- Syntax from the other database, or proximity numbers that don't do what the student intends.

# Items

Return one item per concept, labelled with the concept. Status "strong" if the list is
thorough, "developing" if important kinds of term are missing, "missing" if no terms were given.
In the comment, name which *kinds* of term are covered and which kind is missing. On early
attempts, give at most one example term per concept.

# Worked example (only when allowed)

`modelAnswer` should give a fuller list of terms for each concept, one concept per line.
