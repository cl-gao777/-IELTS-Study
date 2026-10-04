# ADR 0005: Complete, portable backup and transactional restore

- Status: Accepted
- Date: 2026-10-04

The JSON format identifies itself as `ielts-studio`, version `1`. It is a full snapshot of every initialized application table, including vocabulary FSRS state, practice drafts, dictation history, and writing revisions. Imported material bytes are carried in a base64 manifest. The AI provider key is stored separately in `ai-provider.secret.json` and is not exported or overwritten by restore.

## Format compatibility

Version 1 restore requires all current tables and their columns; unknown or omitted tables, malformed JSON fields, unsupported scalar values, invalid file manifests, and dangling database foreign keys are rejected. This intentionally does not claim arbitrary backwards compatibility. A future schema change must supply an explicit backup migration before accepting older formats. Upstream ISTS partial exports are not complete IELTS Studio backups.

Attachment references are portable `upload:<materialId>` values. Original absolute paths and paths containing directory traversal are not accepted on restore. The importer generates fresh UUID filenames under the configured upload directory and retains display filenames. Export resolves symlinks before reading files to ensure they belong to that directory. Attached bytes are limited to 256 MB; larger libraries need a copy of the entire stopped application's data directory.

## Restore safety

Before replacement, save a complete JSON snapshot of current state under the database directory's `backups` folder. If existing attachments are missing, outside the upload directory, not files, or exceed the limit, save a synchronous SQLite snapshot instead and return an explicit warning. This lets a healthy backup repair missing media. Unknown failures still abort. A raw SQLite snapshot contains the database only, so keep the original attachments alongside it.

Write imported attachments into new files, then replace table contents in one SQLite transaction. Foreign keys are temporarily disabled only for this synchronous replacement and checked before commit. Any SQL constraint or foreign-key failure rolls back the entire database and cleans up newly staged files. The original attachments are retained for recovery. Foreign-key enforcement is restored in `finally`.

The optional raw `.db` export uses SQLite's backup API, preserving committed WAL data. It is not a full media backup. Tests reopen its bytes with SQLite and check integrity and foreign-key consistency.
