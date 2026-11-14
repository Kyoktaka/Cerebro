# Retrieval engine

Cerebro ranks passages with a hybrid scorer, then verifies the answer against
exact source quotes before showing it. This document describes the retrieval and
chunking pipeline after the logic optimization.

## Chunking

`rag.js` splits each page's extracted text into overlapping chunks:

- Configurable size and overlap via `CEREBRO_CHUNK_SIZE` (default `1400`) and
  `CEREBRO_CHUNK_OVERLAP` (default `180`).
- Boundaries are chosen in priority order: section heading, paragraph, sentence,
  then word. This keeps related sentences together, avoids splitting a definition
  from its explanation, and starts new chunks at headings.
- `isHeadingLine` recognizes numbered/titled sections (`1.2 Introduction`,
  `Chapter 2`) and short ALL-CAPS lines. Title-case headings such as
  `Results and Discussion` are intentionally not matched to avoid false positives.
- `documentChunks` in `pdf-source.js` attaches a best-effort `heading` field to
  each chunk from the first heading-like line, so passages carry section context
  without a second pass over the PDF.

## Hybrid ranking

`hybrid.js` replaces the old cosine-only ranking in `retrieval.js`. Each passage
is scored with normalized signals:

- **Semantic** similarity: embedding cosine, normalized from `[-1, 1]` to `[0, 1]`.
- **Keyword** overlap: the share of meaningful query terms present in the passage.
- **Exact phrase** match: a contiguous run of 2-3 meaningful query words that
  appears verbatim in the passage (a strong signal for definitions and terms).

The default weights are `semantic: 0.7`, `keyword: 0.3`. No score threshold is
hard-coded; ranking is a sort followed by a coverage-aware selection that
suppresses near-duplicate chunks (Jaccard overlap > 0.85) and caps the count and
context budget. When no query text is supplied, ranking degrades to normalized
cosine similarity, preserving the previous vector-only behavior.

## Progressive fallback

For a targeted question the server tries, in order:

1. Hybrid retrieval (semantic + keyword), top 4 passages.
2. If the reviewed answer has no supported evidence, a single broader
   keyword-only retrieval (`rankByKeywords`, top 6) before giving up.

Document-wide requests (`isDocumentOverview`) use `selectedOverviewChunks` to
sample passages across the selected PDFs' pages instead of a single vector
search. A rejected generative summary falls back to strictly extractive,
page-cited excerpts via `sourceOverview`.

## Evidence verification

Answer generation and verification stay separate (`tutor.js`):

1. A structured draft classifies support (`direct` / `deduced` / `unsupported` /
   `ambiguous`) and returns exact passage quotes by id.
2. `anchors` validates every quote against the retrieved passage text.
3. An independent `review` call scores accuracy, relevance, completeness,
   citations and clarity; all five must be at least 9/10.
4. Failed drafts regenerate at most once with corrective feedback; a failed
   revision returns no answer rather than fabricating evidence.

## Intent understanding

- `resolveDocumentScope` (in `rag.js`) maps named PDFs in the question to the
  selected scope and rejects unselected/missing files.
- `isDocumentOverview` distinguishes whole-document summaries from topic-specific
  summaries, including the conversational `give me a summary about/of/on X`
  phrasing.
- `isFollowup` recognizes conversational references (`give me three examples`,
  `explain that`, `tell me more`) and resolves them against the previous question.
- `studyRequest`/`quizRequest` route quiz, flashcard and reviewer generation to
  the study engine, which shares the same grounding and review stages.
