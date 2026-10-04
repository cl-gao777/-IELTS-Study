import { PracticeLibrary } from "@/components/practice-library";
import { listPracticeSets, listMaterials } from "@/server/store";

export const dynamic = "force-dynamic";

export default function ReadingPracticePage() {
  return <PracticeLibrary kind="reading" sets={listPracticeSets("reading")} materials={listMaterials().filter((material) => material.kind === "reading")} />;
}

