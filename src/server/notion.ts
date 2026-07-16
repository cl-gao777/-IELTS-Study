import "server-only";

import { getDatabase } from "./db";
import { getDashboardSnapshot, exportAllData } from "./store";

const NOTION_VERSION = "2026-03-11";

function logSync(status: string, message: string) {
  getDatabase()
    .prepare(
      `INSERT INTO notion_sync_log (status, message, synced_at)
       VALUES (?, ?, ?)`,
    )
    .run(status, message, new Date().toISOString());
}

export function notionStatus() {
  return {
    configured: Boolean(
      process.env.NOTION_TOKEN?.trim() &&
        process.env.NOTION_PARENT_PAGE_ID?.trim(),
    ),
    version: NOTION_VERSION,
  };
}

export async function backupToNotion() {
  const token = process.env.NOTION_TOKEN?.trim();
  const parentPageId = process.env.NOTION_PARENT_PAGE_ID?.trim();
  if (!token || !parentPageId) {
    const message =
      "Set NOTION_TOKEN and NOTION_PARENT_PAGE_ID before starting a backup.";
    logSync("not-configured", message);
    return { ok: false, message };
  }

  const snapshot = getDashboardSnapshot();
  const exported = exportAllData();
  const title = `ISTS backup · ${snapshot.date}`;
  const markdown = `# ${title}

Generated at ${new Date().toISOString()}.

## Learning snapshot

- Completed tasks: ${snapshot.tasks.filter((task) => task.completed).length}/${snapshot.tasks.length}
- Vocabulary due: ${snapshot.dueVocabulary}
- Review items: ${snapshot.reviewCount}
- Estimated listening: ${snapshot.estimatedBands.listening || "No data"}
- Estimated reading: ${snapshot.estimatedBands.reading || "No data"}
- Estimated writing: ${snapshot.estimatedBands.writing || "No data"}

## Portable JSON

\`\`\`json
${JSON.stringify(exported, null, 2).slice(0, 180_000)}
\`\`\`
`;

  const response = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ type: "text", text: { content: title } }],
        },
      },
      markdown,
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    const message = `Notion backup failed with HTTP ${response.status}: ${body}`;
    logSync("failed", message);
    return { ok: false, message };
  }

  const body = (await response.json()) as { id?: string; url?: string };
  const message = `Backup page created: ${body.id ?? "unknown id"}`;
  logSync("success", message);
  return { ok: true, message, url: body.url ?? "" };
}

