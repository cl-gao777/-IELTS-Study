import { getDataEpoch } from "@/server/data-integrity";
import { WritingWorkspace } from "@/components/writing-workspace";
import { listMaterials } from "@/server/store";
import { listWritingDrafts } from "@/server/writing-drafts";

export const dynamic = "force-dynamic";

export default function WritingPage() {
  return (
    <WritingWorkspace initialDataEpoch={getDataEpoch()} initialDrafts={listWritingDrafts()} materials={listMaterials().filter((item) => item.kind === "writing")} />
  );
}

