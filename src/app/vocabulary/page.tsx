import { VocabularyWorkspace } from "@/components/vocabulary-workspace";
import { listVocabularyEntries } from "@/server/vocabulary";

export const dynamic = "force-dynamic";

export default function VocabularyPage() {
  return (
    <VocabularyWorkspace
      initialWords={listVocabularyEntries()}
      nowIso={new Date().toISOString()}
    />
  );
}
