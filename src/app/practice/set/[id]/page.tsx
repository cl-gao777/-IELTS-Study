import { notFound } from "next/navigation";

import { PracticeRunner } from "@/components/practice-runner";
import { getPracticeSet } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function MaterialPracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const set = getPracticeSet(id);
  if (!set) notFound();
  return <PracticeRunner set={set} />;
}

