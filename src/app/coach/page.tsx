import { CoachWorkspace } from "@/components/coach-workspace";
import { listCoachMessages } from "@/server/store";

export const dynamic = "force-dynamic";

export default function CoachPage() {
  return <CoachWorkspace initialMessages={listCoachMessages()} />;
}

