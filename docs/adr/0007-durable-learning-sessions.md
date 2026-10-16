# ADR 0007: Durable learning sessions and restore protection

- Status: Accepted
- Date: 2026-10-13

## Restore and drafts

All reading, listening, writing and mock saves/submissions carry the current
`dataEpoch`. Restoring a backup rotates it in the same database transaction.
An old or missing epoch returns a refresh conflict before any domain write.
Draft saves use a server revision rather than client timestamps. Restored
revisions advance beyond both the incoming snapshot and current local version.

Restore notifications freeze old clients, stop clocks/audio and pending saves,
and retain unsaved inputs as an exportable recovery copy. The server guard is
authoritative even when a browser misses the notification. AI calls run outside
the database transaction and recheck the epoch/revision before saving results.

## Submission identity and atomicity

Practice rounds share persistent run and submission UUIDs. Only explicit retry
creates another round. A receipt stores a canonical request hash, processing
lease and immutable result. Identical retries return the existing result;
changed content or another submission for the same round conflicts. Unknown
outcomes are queried before retrying the original request. Abandoned worker
leases can be reclaimed after restart.

Practice scores, mistakes, completion state and receipts commit together. Mock
listening/reading scores, the essay, exam record and receipt also commit in one
transaction. No AI feedback means a saved essay marked unassessed, with no fake
writing score or writing-submission record. The legacy overall-band zero sentinel
is retained internally and is not displayed as a complete IELTS score.

## Mock exams

The user chooses nonempty listening/reading sets; original samples are defaults.
Short and incomplete papers are identified by actual original question numbers.
The start operation freezes questions and attachment references. Exams reuse
continuous Passage PDFs and real audio, hide reference answers/transcripts, and
save answers, essay, phase, clocks, Passage, scrolling, zoom and audio position.

The server grants a renewable single-writer lease. Other pages remain read-only.
Leaving, losing foreground focus or closing pauses the exam. Restoring or reopening
never starts a clock or audio automatically. Completed phases cannot be edited.

## Vocabulary time and reviewed course content

Unsent elapsed time belongs to one tab. Sealed packets use a stable UUID and
cumulative seconds; SQLite records only the increase beyond that packet's prior
maximum. Replaying another tab's packet cannot duplicate time. Legacy ledgers
remain unchanged and provide a baseline for old pending packets.

Reviewing advanced material addresses the selected course and target identity,
updates its meaning, part of speech and two linked contexts, and advances their
versions. Local corrections survive package reloads. New cards use the corrected
target; stale cards cannot be graded. Other senses, personal notes, historical
snapshots and FSRS schedules remain unchanged.

## Backup v5 and rollout

Version 5 adds six durability tables. Known complete versions 1–4 upgrade without
inventing past submission IDs or sense data. Attachments, request hashes, frozen
papers and submitted-result relationships are validated before replacement.
Restore failure rolls back data and epoch together. Destructive QA uses isolated
databases. Deployment first snapshots the latest formal installation, then checks
existing histories, FSRS rows and all upload hashes after updating code. Only
public code/resources and regression tests are published to GitHub.
