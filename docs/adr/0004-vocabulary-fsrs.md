# ADR 0004: Durable vocabulary metadata and FSRS

- Status: Accepted
- Date: 2026-10-04

## Decision

Use `ts-fsrs` behind `VocabularyScheduler` for new vocabulary reviews. The four ratings remain Again, Hard, Good, Easy. This small pure TypeScript dependency does not add a server or network requirement. Keep the original `srs.ts` implementation for compatibility with upstream callers and historical tests; the vocabulary API uses the FSRS adapter.

Keep base `vocabulary_words` and `vocabulary_reviews` rows compatible with upstream analytics. Store optional metadata in `vocabulary_metadata`, FSRS state in `vocabulary_scheduler_state`, and review mode, answer, correctness, and duration in `vocabulary_review_details`. The complete backup must include these three tables.

## Migration

Do not change existing due dates during startup or erase review history. On the next review, replay the word's chronological historical ratings with their actual timestamps into FSRS, then apply the new rating. Words with no observed review history start from a new FSRS card: legacy interval/ease values alone do not reliably describe FSRS memory state. Subsequent reviews load persisted FSRS state. Damaged optional scheduler state is reconstructed from durable review history.

Store dates as ISO UTC and render in the browser's local timezone. Disable FSRS fuzz so tests, restore, and historical replay are reproducible. Target retention is 0.9; no personalized parameter fitting is claimed.

## Learning Signals

An Again review creates or increments one unresolved vocabulary Review Item. Every review also records its mode and typed answer. Context cards only hide whole words or phrases from a supplied source/example sentence. Missing meanings and sentences remain explicitly missing; capture never fabricates dictionary definitions.

## Sources

[ts-fsrs API and examples](https://github.com/open-spaced-repetition/ts-fsrs). No implementation code or learning content was copied from the three comparison projects.
