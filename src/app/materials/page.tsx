import { MaterialsWorkspace } from "@/components/materials-workspace";
import { listMaterials } from "@/server/store";

export const dynamic = "force-dynamic";

export default function MaterialsPage() {
  return <MaterialsWorkspace initialMaterials={listMaterials()} />;
}

