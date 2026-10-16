# Backup and restore

IELTS Studio keeps learning history in local SQLite. Notion is optional.

## Portable JSON

Settings → Download JSON backup exports the complete **version 5** snapshot:
learning records, FSRS, courses and local corrections, active sessions, draft
revisions, submission receipts, and uploaded PDF/audio bytes with SHA-256 values.
AI credentials are stored separately and never enter JSON or SQLite exports.
Keep private backups outside the public Git repository.

Settings → choose the exported JSON → enter `RESTORE` replaces the local
snapshot after strict validation. The app first creates a safety backup of
current data. Missing tables, invalid state, dangling references and malformed
or changed attachments reject restoration; replacement failures roll back.
Complete Studio v1–v4 snapshots follow explicit upgrade paths. Incomplete
upstream ISTS exports are unsupported.

Successful restoration freezes old reading, listening, writing and mock pages.
Their unsaved inputs can be exported, but those pages cannot save or submit.
Reload to use restored data. Restored mock exams remain paused. Old submission
tasks retry using the same ID; completed scores are never recalculated.

## Filesystem backup

For a full stopped-installation backup, preserve `data/` including uploads and
the optional private course pack. Preserve local `.env` and
`ai-provider.secret.json` securely; these are not included in portable exports.
SQLite may create `ists.db-wal` and `ists.db-shm`. Stop the application before
copying the database and include these files if present, or use SQLite's online
backup API. Do not copy a changing database file by itself.

For disaster recovery, stop the app, restore the verified filesystem snapshot,
then restart it. Normal Settings restore is preferable for a running app because
it invalidates outstanding browser requests automatically.

## Implementation contract

See [ADR 0005](adr/0005-backup-restore.md) for portable files and schema upgrades,
and [ADR 0007](adr/0007-durable-learning-sessions.md) for epoch, revision,
single-writer and submission protections. Destructive checks use isolated data.
