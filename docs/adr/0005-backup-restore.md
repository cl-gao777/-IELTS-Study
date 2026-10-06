# ADR 0005: Complete, portable backup and transactional restore

- Status: Accepted
- Date: 2026-10-04
- Updated: 2026-10-06

## Version 2 snapshot

The JSON format identifies itself as `ielts-studio`, version `2`, with `exportedAt`, `data`, and `files`. It snapshots every initialized application table, including vocabulary learning state, active sessions, raw review details, immutable grading audit, FSRS state, practice drafts, dictation history, and writing revisions. Imported material bytes travel in a base64 manifest. The AI provider key is stored separately in `ai-provider.secret.json`; JSON and raw database exports exclude it, and restore does not overwrite it.

Version 2 requires all current tables and every column in each row. Unknown or omitted fields/tables, invalid scalars or JSON, malformed vocabulary state, unsupported ratings/modes, invalid attachment manifests, and dangling database foreign keys are rejected. Vocabulary current drafts are checked structurally, including audio playback state; at most one session may be active. Audit ratings must agree with their durable review record. SQL constraints provide the final duplicate-ID and foreign-key checks inside the replacement transaction.

## Explicit version 1 migration

Only the known complete IELTS Studio version 1 format is accepted. Before applying the same strict validation, migration adds absent `vocabulary_learning_state`, `vocabulary_sessions`, and `vocabulary_review_audit` as empty arrays. It also retains the previously supported additive migration for a missing `practice_sets.resource_json`, setting it to `{}`. No other missing old table or column is filled in. Upstream ISTS partial exports and arbitrary older schemas are not complete Studio backups.

After replacement, vocabulary initialization annotates legacy learning state using the earliest historical review, or the original creation date for words with positive repetitions. It does not reschedule cards, alter raw correctness or ratings, replay FSRS during restore, or change old FSRS rows. The audit for old reviews remains absent/unknown; current word text must never be substituted for an unknown historical standard answer. Version 1 has no active vocabulary session to resume unless the known new tables were explicitly present in that snapshot. Validation clones its input before migration and does not mutate the caller's snapshot.

## Portable attachments

Attachment references use `upload:<materialId>`. Original absolute paths and directory traversal are not accepted on restore. The importer generates fresh UUID filenames inside the configured upload directory and retains display filenames. Export resolves symlinks before reading files to ensure they belong to that directory. Official resource references must resolve to an included material and its attachment bytes. Attached bytes are limited to 256 MB; larger libraries require a copy of the entire stopped application's data directory.

## Restore safety and session continuity

Before replacement, save a complete current JSON snapshot under the database directory's `backups` folder. If existing attachments are missing, outside the upload directory, not files, or exceed the limit, save a synchronous SQLite snapshot instead and return an explicit warning. This permits a healthy backup to repair missing media. Unknown failures still abort. The fallback SQLite snapshot contains only the database, so original attachments are retained alongside it.

Write imported attachments into new files, then replace tables in one synchronous SQLite transaction. Save the current vocabulary session revisions before deleting rows. After inserting the snapshot, set each restored revision to `max(restoredRevision, previousLocalRevisionForSameId ?? 0) + 2` and update its timestamp. The two-step increase distinguishes restore from a single checkpoint acknowledgement, which increases the revision by one; an old browser draft therefore cannot mistake a restore for a lost save response. Preserve status, mode, current card and typed draft, skipped IDs, learned/reviewed counters, and submission association. A restored active session can continue after fetching its new revision; it is not ended as a side effect of restore. Old pages and repeated restores cannot reuse the previous write token.

Foreign-key enforcement is temporarily disabled only around the synchronous replacement and checked before commit. Any SQL constraint or foreign-key failure rolls back all rows, including session revisions, and cleans newly staged attachments. Original attachments remain available for recovery. Enforcement is restored in `finally`.

On successful restore, Settings removes `ielts-studio-writing-recovery` and `ielts-studio-vocabulary-recovery` from browser storage, dispatches `studio:backup-restored`, and sends `{ type: 'studio:backup-restored' }` through `BroadcastChannel('ielts-studio-restores')` when available. Other vocabulary pages discard their old recovery draft and reload server state. Browser storage/channel failures do not undo a committed restore: server-side vocabulary revision checks still reject stale writes. Clearing the writing cache prevents that cache from being replayed on a new mount; it does not pause an already-open writing page's autosave. Close active writing pages before replacing the database.

The optional raw `.db` export uses SQLite's backup API, preserving committed WAL data. It is not a complete media backup. Tests reopen its bytes to check database integrity and foreign-key consistency.

## Regression coverage

Isolated temporary databases verify version 2 table/attachment round trips, raw-history preservation during known version 1 migration, rejection of omitted old fields, active-session continuation with new revisions, immutable grading snapshots after word edits, failed-restore rollback and staged-file cleanup, large audio manifests, missing-media repair, and exclusion of provider secrets. Browser notification tests verify both cache keys and graceful operation when storage or BroadcastChannel is unavailable.
