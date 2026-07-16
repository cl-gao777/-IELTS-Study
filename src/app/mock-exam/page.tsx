import { notFound } from "next/navigation";

import { MockExam } from "@/components/mock-exam";
import { listPracticeSets } from "@/server/store";

export const dynamic = "force-dynamic";

export default function MockExamPage() {
  const listeningSet = listPracticeSets("listening")[0];
  const readingSet = listPracticeSets("reading")[0];
  if (!listeningSet || !readingSet) notFound();
  return <MockExam listeningSet={listeningSet} readingSet={readingSet} />;
}

