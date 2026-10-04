import { MaterialsWorkspace } from "@/components/materials-workspace";
import { listMaterials } from "@/server/store";
import { getMaterialMetadata } from "@/server/learning-workspace-store";

export const dynamic = "force-dynamic";

export default function MaterialsPage() {
  const materials = listMaterials();
  return <MaterialsWorkspace initialMaterials={materials} metadata={Object.fromEntries(materials.map((material) => [material.id, getMaterialMetadata(material.id)]))} />;
}

