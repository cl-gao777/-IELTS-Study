<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# ISTS project rules

Read `CONTEXT.md` and relevant files in `docs/adr/` before non-trivial changes.
Use the domain terms Study Loop, Study Task, Practice Attempt, Learning Signal,
Review Item, Coach Turn, Source Material, and Mock Exam consistently.

This is a single-user, desktop-first learning application. Do not add
multi-tenant, billing, teacher-dashboard, or social features unless the product
boundary is explicitly changed.

Never commit API keys or unlicensed IELTS books, audio, PDFs, or question banks.
