# ISTS — IELTS Study OS

ISTS is an open-source, desktop-first IELTS learning workspace for a single
learner. It combines daily planning, vocabulary review, Listening/Reading/
Writing practice, mock exams, mistake review, and an AI English coach in one
long-lived system.

The first milestone is a working learning cockpit. Later milestones will add a
local database, spaced repetition, material import, computer-based mock exams,
AI writing feedback, and optional Notion backup.

## Current milestone

- Desktop-first learning dashboard
- Interactive daily study loop
- Weighted study progress
- Vocabulary review preview
- Mock-exam runway
- 小C coach interaction preview
- Accessible focus states and reduced-motion support
- Unit-tested study progress calculation

## Product principles

1. **One learner, one durable history.** No multi-tenant coaching-centre
   complexity.
2. **Practice before decoration.** Every module must create a useful learning
   signal or review item.
3. **English by default, Chinese when blocked.** The coach helps the learner
   turn Chinese intent into natural English.
4. **Private material import.** The application stores only original, licensed,
   public-domain, or user-supplied learning material.
5. **Local-first data.** The core learning history must remain usable without
   Notion or a third-party database.

## Planned modules

- AI coach and expression correction
- Vocabulary decks and spaced repetition
- Listening practice with audio playback
- Reading practice and evidence review
- Writing Task 1/2 workspace and structured evaluation
- Full computer-based mock exams
- Progress analytics and mistake patterns
- PDF/Word/audio material importer
- Optional Notion backup and export

Speaking practice is intentionally out of scope for the first product.

## Technology

- Next.js App Router
- React + TypeScript
- Tailwind CSS 4 plus scoped CSS Modules
- Vitest
- Planned: SQLite and an OpenAI-compatible model provider

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

Validation:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Configuration

Copy `.env.example` to `.env.local`. Do not commit real API keys.

## Architecture

- Product vocabulary: [`CONTEXT.md`](./CONTEXT.md)
- Initial architecture decision:
  [`docs/adr/0001-local-first-single-user-web-app.md`](./docs/adr/0001-local-first-single-user-web-app.md)
- Learning-material policy:
  [`docs/adr/0002-user-supplied-learning-materials.md`](./docs/adr/0002-user-supplied-learning-materials.md)

## License

MIT
