# ADR 0006: Licensed offline vocabulary courses and fixed context exercises

- Status: Accepted
- Date: 2026-10-08

## Content and personal progress

NGSL 1.2 provides 2,809 canonical members and NAWL 1.2 provides 957. The membership files, not the definition files, decide membership. The release contains 3,766 distinct entries and 7,532 original, checked learning examples. Each published entry has Chinese and English meanings, part of speech, and at least two distinct context exercises. This is an IELTS preparation course, not an official IELTS syllabus or a bank of actual IELTS vocabulary questions.

The source files and SHA256 manifest ship with the application. Public data and our adaptations are attributed to Browne, Culligan, and Phillips under CC BY-SA 4.0. Incorrect or absent source definitions are explicitly recorded as corrections in the manifest. Learning does not call a live AI service.

Course registration never creates personal cards or ratings. Beginning a particular word links an existing normalized personal term or creates a new card. Cross-course appearances share that one FSRS state; course content does not overwrite personal meanings, notes, history, or schedules. Pausing new words also holds unlearned personal cards. Globally due learned words remain eligible subject to the focus and persistent dispositions described below.

## Exercise and session contract

The default mode is context. Each exercise freezes a stable ID, content version, sentence, exact target span and surface form, accepted spellings, Chinese sense, and source. Accept only the registered surface and appropriate spelling variants. Do not infer synonyms or arbitrary inflections. Mask every occurrence of the answer, including variants and phrases, before revealing the card.

New words have a labelled learning phase and a one-minute first recall. Learning, deferring, changing mode, importing, browsing and assessment do not grade a card. Answer checking suggests a rating; only Continue saves the grade. Near-match typo confirmation retains raw incorrectness and excludes a forgetting Review Item. Subsequent due reviews cycle through all available published exercises, once per schedule event.

After a scheduled context review, Continue and practice another sentence atomically saves its single scheduled grade and selects one different published context for the same word. This optional supplemental card has its own immutable submission ledger and session counter. It records the original input, objective correctness, typo decision and frozen exercise, but does not update FSRS, due dates, repetition counts, context rotation or forgetting Review Items. The supplemental card has no schedule forecast or difficulty controls. Both ledgers use unique submission IDs and can be queried before retrying an uncertain response.

SQLite checkpoints and immediate browser drafts preserve the exact selected exercise and input. Immutable historical reviews keep their old sentence and answer. A changed, removed or unpublished current exercise rejects a new grade rather than scoring the old input against changed content. Synchronization invalidates that current card and selects an up-to-date exercise. Management ends the learning round. Background synchronization preserves management components and unsaved form state.

Recovery prioritizes the active session before ended sessions, with deterministic timestamp and ID ordering; restored row order is irrelevant. Editing English inherits only that personal word's existing progress, detaches its former catalog association and matches the new normalized term when safe. It never merges two personal schedules or steals another word's catalog link. The changed word version invalidates an older open card.

The daily 15-minute goal is soft. Only focused, visible, unpaused activity counts; sleep and background gaps are excluded. Heartbeats use unique IDs and a restore version so acknowledgements can be retried without duplication, and packets created before a restore cannot append time afterwards. Goal, pause, course selection, course editing and starting a round also check restore state. The v3 baseline and its explicit v1/v2 migrations are described in ADR 0005; v4 adds the target contracts below.

## v4: Advanced meanings and private course updates

A target identifies a versioned part of speech and meaning, independently of the personal word's meaning or FSRS state. Its explicit course membership lists the allowed exercises and has its own version and rank. All four practice modes use the frozen target's meaning and permitted spellings; context answers use that exercise's registered surface forms. Existing catalog ranks, examples, personal notes and schedules remain intact. Level evidence distinguishes word/POS evidence from reviewed sense selection; frequency is not a CEFR level. Private PDF references retain the upload material ID, SHA256, page and quote.

The first private-package activation selects `ielts-advanced`; later content updates preserve the learner's chosen focus and course. Advanced eligibility requires a published B2/C1 target, an eligible membership with two distinct published contexts, and no target or whole-term pause. This rule applies to global due words, new targets, caches, previews and submissions. Basic or unclassified personal words keep their history and FSRS while excluded. Course switches and assessment recommendations do not change focus, and target cards cannot fall back to old basic examples.

Queue selection prioritizes scheduled due words, then due minute consolidation, then new target introductions. The persisted B2/C1 cursor changes to the opposite level only after an introduction is confirmed; an empty level falls back to the available level. Membership rank orders candidates without changing the original catalog rank. A word can have one active new-meaning consolidation at a time. Mode changes skip the entire word for that round, preserving confirmed introductions and minute steps.

`learn-word` retains the original non-scoring learning action and one-minute first scheduled recall. `learn-target` introduces a familiar word's new meaning immediately and creates separate one-minute and ten-minute context consolidation steps without resetting or advancing its FSRS. Other purposes are `scheduled`, `supplemental`, `consolidation` and `merged`. A consolidation and a scheduled event due for the same word and target are frozen as one `merged` card: one scheduled sample advances FSRS once and atomically satisfies the minute step, with no duplicate auxiliary sample. A card issued as auxiliary remains auxiliary even if FSRS becomes due while answering.

Auxiliary attempts retain raw answers, objective correctness, typo decisions and immutable exercise snapshots in their own ledger. Correct answers or a valid explicit typo confirmation advance the minute step; another failure retries that step one minute later. Auxiliary errors contribute to practice/spelling statistics but do not change FSRS or create forgetting Review Items. Saved minute attempts rotate contexts; ordinary optional supplemental practice retains its earlier scheduling and rotation behavior. Unique operation/submission IDs, session revisions and target-state versions protect both ledgers and step advancement from retries and competing pages.

Self-reporting “this use is known” pauses the target across courses, including before a personal word exists; it does not certify mastery or produce a rating. “Do not study this word” persists a separate normalized-term pause. Explicit resume checks state versions and prevents two concurrent consolidations for a word. English edits preserve the personal schedule, detach former target links, and leave the former term's disposition in place. Pauses and detached minute steps are not guessed onto a renamed word, and different personal FSRS states are never merged.

A higher private-package version is authoritative only for its own memberships. Absent meanings lose that private membership when shared elsewhere, or become versioned drafts when it was their last membership. Archived definitions, provenance, original exercises, target state and audits remain available to backup; other courses remain published. Old cards fail current-content checks. A learned word with no first rating can introduce a corrected replacement target when its former meaning is withdrawn or paused; a live first recall still holds back another introduction. This avoids an orphaned queue without resetting the original learning date or due time. First activation ends an old active round while preserving its answer state; later upgrades do not reapply defaults.

Live cards bind word, target, exercise, membership, target-state, session, restore and policy versions. Historical snapshots must have valid internal target/exercise/course references and valid PDF hashes, but need not equal today's meaning or membership after an edit or withdrawal. Backup v4 includes target states, term dispositions and operation ledgers; explicit v1/v2/v3 upgrades add known defaults without inventing missing target information or recalculating prior ratings, dates or FSRS. Restore keeps frozen inputs and minute events, advances invalidation tokens, and retains the attachment validation and rollback contract.

## Continuous card transitions (2026-10-24)

The vocabulary session, introduction and review endpoints accept an optional `advance` flag. New clients request one persisted next assignment in the successful save response; old clients retain the separate `next` action. Ordinary typing checkpoints do not advance. An idempotent replay returns the existing assignment, without grading or drawing again. The score or introduction commits before selection: a failed next-card read reports `nextError` while preserving the successful save. Recovery verifies the original operation/submission ID and retries only drawing when the save is known to exist.

Responses include a queue state (`ready`, `waiting` or `empty`) and the next eligible due time. A background check leaves the current interface mounted and interactive, checks immediately when the known due time arrives, and otherwise checks no more often than every 30 seconds. Foreground-only timing and existing restore/version guards remain authoritative. No card is graded early and no basic word is inserted to fill a wait.

SQLite read scopes exist only for one request. Target definitions, target states and term dispositions are indexed within that scope; mutations invalidate mutable reads, content changes invalidate definitions, and rollback invalidates the scope before recovery reads. Personal word history and learning metadata use batch queries. There is no new persisted cache or schema, and backup remains version 6.

## Keyboard continuation

The active vocabulary card maps an unmodified, non-repeated Enter to its enabled primary button: check/reveal, then ordinary Continue; learning introductions use their existing learning confirmation. It never queues input while saving or waiting for a forecast. IME confirmation, other focused controls, open menus/dialogs, background pages and unmounted/paused cards do not invoke this shortcut. The same button callbacks retain all existing grading, idempotency and recovery checks; no API or backup change is needed.

## Optional assessment and imports

Thirty frozen context questions sample five foundation frequency bands (four each) and ten academic entries. The first foundation band below three correct suggests its starting rank; otherwise suggest academic. Results are a course recommendation, never a total vocabulary estimate or FSRS update. Skipping defaults to academic.

Analytics separately reports explicit first-learning counts, scheduled grades, supplemental practice accuracy and completed assessment samples/recommendations. Unknown legacy learning dates or assessment results stay unknown. The 90% setting is a scheduling target; self-ratings are not a measured memory rate, and a long interval does not certify mastery of every practice mode.

TXT, CSV and XLSX imports preview valid, duplicate, existing, invalid and incomplete rows. Confirmation is idempotent and registers a course. Existing public entries may be reused; new incomplete entries stay draft until their meanings and two exercises are reviewed. Excel formulas, macros and unsafe archives are not evaluated.

## Local reading provenance

Reading extraction uses existing Passage ranges, local PDF parsing and at most two parsers. It excludes headings, questions, footers and incomplete sentences, joins wrapped lines and hyphenation, and conservatively matches known members and registered surface forms. A candidate preserves material ID, original file SHA256, Passage, page range, the cleaned-text format version, character span and exact quote.

Private extracted sentences stay in local SQLite as draft and are never included in the public source package or sent to an external service. Re-extraction is idempotent and retains reviewed material. Publishing a reviewed original sentence keeps its provenance; editing its text removes the original-quote reference and labels it as a personal example. Restore checks included attachment hashes, Passage/page linkage and quote consistency without running OCR or recreating the original text.
