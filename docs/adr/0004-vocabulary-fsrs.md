# ADR 0004: Vocabulary learning, raw answers, and FSRS scheduling

- Status: Accepted
- Date: 2026-10-04
- Updated: 2026-10-06

## Learning and review are separate actions

A newly captured word has not yet been learned. Introduce its answer and usable meaning before asking for recall. Confirming first learning sets `learning_started_at` and a first recall due time one minute later. It does not create a graded review, a fabricated correct answer, or an FSRS rating. Cards missing a usable meaning remain available for editing and cannot complete the introduction.

The four review modes are `recognition` (seeing the English term and assessing knowledge of its meaning), `recall` (recovering the term from a meaning cue), `spelling` (recovering the term from audio), and `context` (recovering the term from a sentence with whole-word or phrase masking). Recognition is self-assessment and has no objective correctness value. The other modes compare the raw submitted answer with the term using the same normalization on client and server. A spelling review requires a recorded successful audio playback; unavailable speech can be deferred without grading.

Answer exposure and draft changes belong to the current server session. The front, revealed answer, and first-learning phase are explicit states. Queue position, skipped words, mode, current draft, reviewed count, and learned count survive refresh. The library remains a separate management view. Missing definitions or example sentences are never generated silently.

## Raw answer and scheduling decision

The server checks answers independently. Giving up or submitting an incorrect answer applies Again even if a different rating is requested. A learner may explicitly confirm a near-match typing error; the one-edit typo check only permits this for a nonempty incorrect answer that was not given up. The learner's requested rating can then be applied, while raw correctness remains false. Recognition stores correctness as null.

Every new graded review stores both requested and effective ratings, a decision reason, mode, original typed answer, raw correctness, typo/give-up flags, the word version, and the exact term at grading time. Editing the word later does not change the historical standard-answer snapshot. `submission_id` makes retries return the prior result without creating a second review. The draft, word version, session ID, and session revision must match before a new grade is accepted; stale pages receive a conflict and must reload server state.

## Durable schema

Keep the original `vocabulary_words` and `vocabulary_reviews` columns unchanged. The extension tables are:

| Table | Purpose |
| --- | --- |
| `vocabulary_metadata` | Source sentence/material, optional lexical notes, and other editable metadata |
| `vocabulary_scheduler_state` | Serialized FSRS state |
| `vocabulary_review_details` | Mode, raw answer, nullable correctness, and duration |
| `vocabulary_learning_state` | Per-word review version and nullable first-learning timestamp |
| `vocabulary_sessions` | Revision, status, current draft and queue state, and timestamps |
| `vocabulary_review_audit` | Unique submission ID, session relation, grading snapshot and decision |

For legacy words, initialization adds only the learning-state annotation: the earliest recorded review date, otherwise the original creation date when repetitions are positive, otherwise null. Old due dates, raw correctness, ratings, and scheduler rows remain unchanged. Missing historical audit rows mean unknown; neither the old answer snapshot nor a typo confirmation is reconstructed from today's word text.

## FSRS behavior

Use `ts-fsrs` behind `VocabularyScheduler`, with Again, Hard, Good, and Easy. The dependency is local and requires no network service. Target retention is 0.9, fuzz is disabled, learning steps are 1 and 10 minutes, and the relearning step is 10 minutes. Show actual computed outcome previews after revealing the answer. Preview is read-only, including when a legacy card has no optional scheduler state.

On the next graded review of a legacy word without valid FSRS state, replay chronological historical ratings at their actual timestamps and then apply the new rating. Words without review history begin from an empty FSRS card; legacy interval/ease values alone do not establish memory state. Later reviews load persisted state. Invalid optional scheduler state can be reconstructed from durable ratings. No personalized parameter fitting or independent scheduling per review mode is claimed.

Dates are stored as ISO UTC. Again creates or increments one unresolved vocabulary Review Item unless the learner confirmed an eligible typing error; a confirmed typo remains in raw spelling history without being classified as forgetting. Review duration and browser study-time tracking remain distinct; first learning does not fabricate study time.

## Statistics

Raw accuracy always uses `vocabulary_review_details.correct`. A confirmed typo is counted separately and remains an incorrect raw answer. Each mode shows its review count, objective sample count, raw accuracy, and confirmed typo count. Recognition has zero objective samples and null accuracy, even for inconsistent old rows. Missing audit information is reported as unknown.

The label “复习自评记得比例” describes the proportion of requested ratings other than Again; legacy records use their original rating because the requested rating is unknown. “进入较长复习间隔” counts learned words whose current interval is at least 21 days, without implying mastery of all four skills. New means learning has not started; first-learned or previously reviewed words remain Learning even when an Again resets repetitions to zero. Due retains its date-based count and the UI states that it includes new words.

## Backup and source

All extension tables are included in backup version 2. Restore preserves an active card and queue while raising session revisions to invalidate old clients; details are in [ADR 0005](0005-backup-restore.md).

Scheduler reference: [ts-fsrs API and examples](https://github.com/open-spaced-repetition/ts-fsrs). No implementation code or learning content was copied from comparison projects.
