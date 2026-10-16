# Public source release

Target: `https://github.com/cl-gao777/-IELTS-Study`, default branch `main`.

This distribution runs independently on each learner's computer. It contains
the application, original sample exercises and the attributed NGSL/NAWL pack:
3,766 words and 7,532 original contexts. A fresh database defaults to the
academic course and also has eight original personal starter words.

It excludes the maintainer's database, history, uploads, private advanced PDF
catalog, environment files, keys, installation backups and development artifacts.
Private advanced-sense learning remains a supported optional import capability,
not preinstalled public course content. The code uses MIT; the adapted public
learning pack uses CC BY-SA 4.0 with its source files and hash manifest.

## Windows validation — 2026-10-12

- 40 test files, 352 tests passed; type checking, lint and production build passed.
- The source release smoke check uses its own empty temporary database and
  absent private catalog, never the maintainer's installation data.
- Seven primary pages render; both public courses register with 2,809 and 957
  ready entries. After deferring sample cards without grading, the academic
  course produces a usable fixed context learning card.
- An original PDF fixture imports through the production HTTP endpoint. A v4
  backup includes it; after a process restart the exact card and attachment
  hash are preserved.
- `scripts/smoke-local-install.cjs` repeats this check after a production build.
  GitHub Actions runs checks and this smoke on Windows and Ubuntu with Node 24.
- A new Git clone with no inherited `node_modules`, `.env`, database or private
  course installed 518 locked packages successfully. The same 352 tests, type
  check, lint, production build and HTTP/restart smoke passed in that clone.
- The publication audit inspected 302 tracked files and 506 reachable historical
  blobs: no private runtime paths or common credential patterns were found.
  The catalog and all four downloaded sources match their indexed SHA-256;
  Git attributes preserve those bytes across different checkout line endings.

The optional Docker runtime has been corrected to the npm lockfile and full
Linux runtime layout. Docker was unavailable locally, so no Docker build/run
result is claimed. Linux/macOS manual installation is documented; Windows is
the platform verified before publication. Remote CI results are reported
separately from these local checks.

## Publishing and future updates

Retain both upstream and repository-owner MIT attribution. Merge the target
repository's existing initial commit normally and push a tested commit to
`main`; do not overwrite its history. Review the staged file list and reachable
history for private content and credential patterns before publication.

Future releases should validate a clean clone, not copy a developer's working
directory or `node_modules`. Learners should back up local data before updating.

## Durable practice release — 2026-10-16

The first six audited defects are repaired: restored pages cannot write old
content, practice/mock submissions have stable identities and atomic results,
mock exams support selected frozen papers and paused recovery, vocabulary time
uses cumulative segments, and course edits address the exact sense.

- 397 tests across 44 files pass, with type checking, lint and production build.
- The production installation smoke tests backup v5, original PDF import,
  process restart, exact card/exam recovery, repeat submissions, stale-page
  rejection, 5-second replay remaining 5 seconds, and unavailable-AI essays.
- Browser checks include cross-page restore freeze and export, original mock
  recovery, actual personal Passage PDF rendering and position restoration,
  and 320px layouts. A narrow-screen writing style-order defect and a same-word
  sense-editor remount defect were corrected during acceptance.
- Local QA and safety backups are ignored by Git. Private files, learning
  histories, credentials and the optional private catalog are excluded.
- GitHub Actions repeats installation, checks and production HTTP smoke tests
  on Windows and Ubuntu with Node 24. Remote results are reported separately.
