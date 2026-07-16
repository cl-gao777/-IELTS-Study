import { VocabularyWorkspace } from "@/components/vocabulary-workspace";
import { listVocabulary } from "@/server/store";

export const dynamic = "force-dynamic";

export default function VocabularyPage() {
  return (
    <VocabularyWorkspace
      initialWords={listVocabulary()}
      nowIso={new Date().toISOString()}
    />
  );
}
