import { WritingWorkspace } from "@/components/writing-workspace";
import { listWritingSubmissions } from "@/server/store";

export const dynamic = "force-dynamic";

export default function WritingPage() {
  return (
    <WritingWorkspace initialSubmissions={listWritingSubmissions(5)} />
  );
}

