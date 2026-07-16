import { notFound } from "next/navigation";

import { PracticeRunner } from "@/components/practice-runner";
import { listPracticeSets } from "@/server/store";

export const dynamic = "force-dynamic";

export default function ReadingPracticePage() {
  const set = listPracticeSets("reading")[0];
  if (!set) notFound();
  return <PracticeRunner set={set} />;
}

