# ISTS product specification

## Objective

Deliver a privately deployable, single-user, desktop-first IELTS learning
operating system. The learner can plan daily study, remember vocabulary,
practice Listening/Reading/Writing, run timed computer-based mock exams, review
mistakes, ask an AI coach for help, import owned materials, and optionally back
up selected records to Notion.

Speaking practice is out of scope.

## Required user journeys

### Daily study

1. Open the dashboard and see today's Study Loop.
2. Start or complete Study Tasks.
3. See study minutes, streak, due vocabulary, and estimated band readiness.
4. Resume the next unfinished activity.

### AI coach

1. Ask in English, Chinese, or mixed language.
2. If Chinese or mixed language is used, receive a natural English expression.
3. Receive an answer from 女仆小C with corrections and next actions.
4. Preserve the Coach Turn in local history.
5. Try configured AI providers in order and fail over automatically.

### Vocabulary

1. Add words manually or from Practice Attempts.
2. Review due cards using Again / Hard / Good / Easy.
3. Schedule future reviews with spaced repetition.
4. See due counts, mastery, and recent review history.

### Reading

1. Open a passage in a left-panel/right-question computer-test layout.
2. Answer supported question types under a timer.
3. Submit and receive raw score, estimated band, correct answers, and evidence.
4. Convert mistakes and unknown words into Review Items.

### Listening

1. Start an audio-based timed exercise.
2. Play the recording from the beginning without exposing the transcript.
3. Answer questions while audio plays.
4. Submit and review transcript evidence, spelling errors, and answers.

### Writing

1. Choose Task 1 or Task 2.
2. Write under a timer with live word count.
3. Submit to the AI evaluator.
4. Receive a structured report for task response/achievement, coherence,
   lexical resource, and grammatical range/accuracy.
5. Save the response, evidence, corrections, and rewrite actions.

### Mock exam

1. Launch a Listening + Reading + Writing exam.
2. Move through modules in order with persistent timing and answers.
3. Submit each module and complete the exam.
4. See combined results and module-level review.

### Materials and backup

1. Import owned text, PDF, Word, image, or audio source material.
2. Retain provenance metadata.
3. Extract supported document text and turn it into editable AI-generated
   Reading or Listening practice content.
4. Export all local learning data.
5. Optionally sync selected summaries and records to Notion.

## Completion evidence

The product is complete only when:

- all routes above are implemented and reachable;
- local persistence survives process restart;
- critical scoring, SRS, provider fallback, and mock-exam logic have tests;
- production build passes;
- an end-to-end browser check covers the main journeys;
- the application is deployed to the designated Ubuntu server without changing
  unrelated server projects;
- the GitHub repository contains setup, backup, and deployment documentation.
