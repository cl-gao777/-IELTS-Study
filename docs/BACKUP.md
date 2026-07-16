# Backup and restore

ISTS keeps the primary learning history in SQLite. Notion is an optional,
one-way snapshot target, not a required dependency.

## Files to protect

```text
data/ists.db
data/uploads/
```

SQLite may temporarily create `ists.db-wal` and `ists.db-shm`. For a filesystem
backup, either stop the ISTS process briefly or use SQLite's online backup
command.

## JSON export

Open **Settings → Download JSON backup**. The export contains:

- settings and Study Tasks;
- vocabulary and review scheduling;
- practice sets, attempts, answers, and scores;
- coach history;
- writing submissions and feedback;
- imported material metadata;
- Review Items and Mock Exams.

Uploaded binary files are not embedded in JSON. Back up `data/uploads/`
separately.

## Server backup example

```bash
mkdir -p /var/backups/ists
sqlite3 /www/wwwroot/ists/current/data/ists.db \
  ".backup '/var/backups/ists/ists-$(date +%F-%H%M).db'"
tar -czf "/var/backups/ists/uploads-$(date +%F-%H%M).tar.gz" \
  -C /www/wwwroot/ists/current data/uploads
```

## Restore

1. Stop the ISTS application process.
2. Replace `data/ists.db` with the selected backup.
3. Restore `data/uploads/`.
4. Ensure the service user can read and write the restored files.
5. Start ISTS and open Settings to verify the database path.

## Notion backup

Set these server-side variables:

```env
NOTION_TOKEN=
NOTION_PARENT_PAGE_ID=
```

The integration needs access to the selected parent page. Each backup creates a
new dated child page containing a learning snapshot and portable JSON.

