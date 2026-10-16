# UI refresh — 2026-10-16

The workspace uses a warm white/ink/forest palette with semantic light/dark
colors, Source Sans 3 served from the application, and Lucide navigation icons.
Font and icon licenses are bundled under `public/licenses/`.

Shared CSS modules define controls (8px radius), panels (12px), readable
13px+ helper text and 16px inputs. The dashboard has one primary next task,
a daily task list and compact recent signals. Vocabulary retains the centered
960px review card; learning settings and secondary statistics expand on demand.
Reading retains Passage PDFs, two independently scrolling columns and paper
colors. All remaining routes use the same tokens and controls.

At <=760px the desktop navigation becomes a native modal drawer. It starts
on Close, traps Tab/Shift+Tab, closes with Escape or navigation and restores
focus to its opener. Desktop resizing closes an open mobile drawer. Reading
and exam sticky controls account for the 64px mobile header; fullscreen
reading keeps a zero offset. Reduced-motion preferences are respected.

No server API, database schema, review scheduling, scoring, backup format or
session protocol changes are part of this release. Use disposable data for
interactive acceptance. Local screenshots and acceptance reports remain ignored
because they may contain personal materials or learning statistics.
