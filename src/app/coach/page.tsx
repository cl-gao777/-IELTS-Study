import { CoachWorkspace } from "@/components/coach-workspace";
import { listCoachMessages } from "@/server/store";

export const dynamic = "force-dynamic";

export default async function CoachPage({searchParams}:{searchParams:Promise<{context?:string}>}) {
  const {context}=await searchParams;
  return <CoachWorkspace initialMessages={listCoachMessages()} initialInput={context ? `请解释这个问题：${context.slice(0,2000)}` : ""} />;
}

