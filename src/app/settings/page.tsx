import path from "node:path";

import { SettingsWorkspace } from "@/components/settings-workspace";
import { loadAiProviders } from "@/server/ai";
import { notionStatus } from "@/server/notion";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const providers = loadAiProviders().map((provider) => ({
    name: provider.name,
    model: provider.model,
    wireApi: provider.wireApi,
  }));
  const configuredDatabase =
    process.env.DATABASE_URL ?? "file:./data/ists.db";
  const configuredPath = configuredDatabase.replace(/^file:/, "");
  const databasePath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(
        /* turbopackIgnore: true */ process.cwd(),
        configuredPath,
      );

  return (
    <SettingsWorkspace
      providers={providers}
      notionConfigured={notionStatus().configured}
      databasePath={databasePath}
    />
  );
}
