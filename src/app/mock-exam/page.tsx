import { MockExam } from "@/components/mock-exam";
import { listPracticeSets } from "@/server/store";

export const dynamic = "force-dynamic";

export default function MockExamPage() {
  const hideAnswers = (set: ReturnType<typeof listPracticeSets>[number]) => ({ ...set, transcript: "", questions: set.questions.map((q) => ({ ...q, answers: [], explanation: "", evidence: undefined, answerGroupTargets: undefined })), resource: set.resource ? { ...set.resource, answerDocuments: [], transcriptDocuments: [] } : undefined });
  return <MockExam listeningSets={listPracticeSets("listening").filter((set) => set.questions.length > 0).map(hideAnswers)} readingSets={listPracticeSets("reading").filter((set) => set.questions.length > 0).map(hideAnswers)} />;
}

