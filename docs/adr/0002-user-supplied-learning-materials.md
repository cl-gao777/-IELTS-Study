# ADR 0002: User-supplied learning materials

- Status: Accepted
- Date: 2026-07-16

## Context

Many public IELTS repositories mix open-source code with third-party books,
audio, PDFs, or scraped exercises whose redistribution rights are unclear.

## Decision

The public ISTS repository will not bundle commercial IELTS books, official
past papers, scraped third-party question banks, or unlicensed audio.

ISTS will instead provide import pipelines for:

- learner-owned PDF and Word documents;
- learner-owned audio files and transcripts;
- original exercises;
- clearly licensed or public-domain material.

Every imported Source Material record will retain provenance and ownership
notes.

## Consequences

- The repository remains safe to fork and redistribute.
- A private deployment may import material the learner is entitled to use.
- Import quality and question validation become first-class product features.
