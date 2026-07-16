# ADR 0001: Local-first single-user web application

- Status: Accepted
- Date: 2026-07-16

## Context

The learner needs one durable IELTS workspace that works well on a desktop,
retains long-term learning history, and can be privately deployed to an existing
Ubuntu server. Existing open-source projects are either desktop-only,
multi-tenant, dependent on hosted databases, or incomplete.

## Decision

ISTS will be built as a Next.js web application with:

- one learner profile;
- a server-side AI-provider adapter;
- a local SQLite database in a later milestone;
- modular Listening, Reading, Writing, Vocabulary, Coach, and Mock Exam areas;
- optional Notion export/backup rather than Notion as the primary database.

Interactive islands remain Client Components. Secrets, provider calls, material
processing, and persistence remain server-side.

## Consequences

- Deployment is simple and inexpensive.
- Learning data remains under the learner's control.
- Multi-user authentication and tenant administration are deliberately omitted.
- A future mobile layout is possible but is not a current design constraint.
