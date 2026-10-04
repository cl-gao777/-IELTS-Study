import { WritingWorkspace } from "@/components/writing-workspace";
import { listMaterials } from "@/server/store";
import { listWritingDrafts } from "@/server/writing-drafts";

export const dynamic = "force-dynamic";

export default function WritingPage() {
  return (
    <WritingWorkspace initialDrafts={listWritingDrafts()} materials={listMaterials().filter((item) => item.kind === "writing")} />
  );
}

