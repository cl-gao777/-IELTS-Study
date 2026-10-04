import { PracticeLibrary } from "@/components/practice-library";
import { listPracticeSets, listMaterials } from "@/server/store";

export const dynamic = "force-dynamic";

export default function ListeningPracticePage() {
  return <PracticeLibrary kind="listening" sets={listPracticeSets("listening")} materials={listMaterials().filter((material) => material.kind === "listening")} />;
}

