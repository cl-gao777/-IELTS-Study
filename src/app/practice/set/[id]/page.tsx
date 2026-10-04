import { notFound } from "next/navigation";

import { PracticeRunner } from "@/components/practice-runner";
import { getPracticeSet } from "@/server/store";
import { getPracticeWorkspaceState } from "@/server/learning-workspace-store";

export const dynamic = "force-dynamic";

export default async function MaterialPracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const set = getPracticeSet(id);
  if (!set) notFound();
  return <PracticeRunner key={set.id} set={set} initialState={getPracticeWorkspaceState(set.id)} />;
}

