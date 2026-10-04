import { notFound } from "next/navigation";
import { getMaterial } from "@/server/store";
import { getMaterialMetadata } from "@/server/learning-workspace-store";
import { MaterialDetail } from "@/components/material-detail";
export const dynamic = "force-dynamic";
export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id); const material = getMaterial(id);
  if (!material) notFound();
  return <MaterialDetail material={material} initialMetadata={getMaterialMetadata(id)} />;
}
