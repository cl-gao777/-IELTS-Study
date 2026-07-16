# ISTS domain context

ISTS is a single-user IELTS learning operating system. The system is organised
around a durable learning loop rather than around isolated chat messages or
files.

## Core terms

### Study Loop

The learner's planned sequence for one day: recall, targeted practice, timed
practice, and review. A Study Loop contains multiple Study Tasks.

### Study Task

A concrete, completable learning action with an area, target, estimated
duration, and completion state.

### Practice Attempt

One completed or abandoned interaction with an exercise or mock-exam module.
Attempts preserve answers, timing, score, and source-material identity.

### Learning Signal

An observable result extracted from a Practice Attempt, such as a spelling
error, weak question type, recurring grammar issue, or newly encountered word.

### Review Item

A scheduled unit created from a Learning Signal. Review Items include
vocabulary cards, reading evidence questions, listening dictation fragments,
and writing corrections.

### Coach Turn

A learner message and the coach response. A Coach Turn may contain:

- a natural-English rewrite of Chinese or mixed-language intent;
- an answer to the learner's actual question;
- corrections and short explanations;
- links to relevant Review Items or Practice Attempts.

### Source Material

An original, licensed, public-domain, or user-supplied document, audio file,
passage, question set, or writing prompt. Source Material must retain provenance
metadata.

### Mock Exam

A timed composition of Listening, Reading, and Writing modules that mirrors the
computer-delivered IELTS workflow. Speaking is not part of the initial product.

## Product boundary

ISTS is not a coaching-centre platform. It has no public student registration,
tenant separation, teacher dashboard, billing, or social leaderboard. The first
deployment serves one learner on a private server.
