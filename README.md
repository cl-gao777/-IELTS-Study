# ISTS — IELTS Study OS

ISTS is an open-source, desktop-first IELTS learning workspace for one learner.
It combines a durable study history, spaced-repetition vocabulary, objective
Listening/Reading practice, Writing feedback, full computer mock flows,
mistake review, material import, analytics, and a persistent AI English coach.

Speaking practice is intentionally out of scope.

## What is implemented

- Daily Study Loop with persistent completion and weighted minutes
- 女仆小C AI coach for Chinese, English, and mixed-language questions
- Natural-English rewrites and ordered AI provider fallback
- SQLite vocabulary deck with Again / Hard / Good / Easy SRS
- Original Academic Reading and Listening drills with timing and evidence
- Browser-based English audio playback and imported audio playback
- Task 1/2 writing editor, timer, word count, AI criteria feedback, and history
- Listening → Reading → Writing computer mock with combined results
- Automatic mistake-to-review queue
- Attempt, writing, and mock analytics
- Text, PDF, DOCX, image, and audio material import
- AI generation of editable practice sets from imported text
- Full JSON export and optional one-way Notion backup
- Desktop UI designed for a private, single-user deployment

The repository includes only original sample exercises. Bring your own
licensed, public-domain, or personally created learning material.

## Technology

- Next.js App Router, React, TypeScript
- SQLite through `better-sqlite3`
- Zod validation
- CSS Modules and Tailwind CSS 4
- Vitest
- OpenAI Responses API or Chat Completions-compatible providers
- Optional Notion API backup

## Quick start

Requirements: Node.js 22+ and pnpm.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open `http://localhost:3000`.

The database is created automatically at `data/ists.db`. It is excluded from
Git.

## AI provider configuration

Providers are tried in this order:

1. `AI_PROVIDERS_JSON`
2. `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`
3. the active Codex configuration under `CODEX_HOME` or `~/.codex`

Example ordered list:

```env
AI_PROVIDERS_JSON=[{"name":"primary","baseUrl":"https://api.example.com/v1","apiKey":"...","model":"gpt-5","wireApi":"responses"},{"name":"backup","baseUrl":"https://backup.example.com/v1","apiKey":"...","model":"model-name","wireApi":"chat-completions"}]
```

Keys stay server-side. If every provider fails, coach and writing modules use a
deterministic local fallback instead of losing saved work.

For an internet-reachable single-user deployment, set
`ISTS_BASIC_AUTH_USER` and `ISTS_BASIC_AUTH_PASSWORD`. The app then protects
pages, APIs, exports, and uploaded files with HTTP Basic Authentication.

## Validation

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The test suite covers study progress, SRS scheduling, objective scoring,
estimated bands, mock overall rounding, and provider fallback order.

## Data and backup

- SQLite: `data/ists.db`
- Uploaded private files: `data/uploads/`
- JSON export: Settings → **Download JSON backup**
- Optional Notion snapshot: Settings → **Backup to Notion now**

See [`docs/BACKUP.md`](./docs/BACKUP.md).

Both locations can be moved outside the checkout with `DATABASE_URL` and
`UPLOAD_DIR`.

## Deployment

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for a production deployment
using a dedicated process, persistent data directory, and Nginx Basic
Authentication.

## Architecture

- Product vocabulary: [`CONTEXT.md`](./CONTEXT.md)
- Product specification: [`docs/PRODUCT.md`](./docs/PRODUCT.md)
- Local-first decision:
  [`docs/adr/0001-local-first-single-user-web-app.md`](./docs/adr/0001-local-first-single-user-web-app.md)
- Learning-material policy:
  [`docs/adr/0002-user-supplied-learning-materials.md`](./docs/adr/0002-user-supplied-learning-materials.md)
- AI fallback:
  [`docs/adr/0003-ai-provider-fallback.md`](./docs/adr/0003-ai-provider-fallback.md)

## License

MIT
