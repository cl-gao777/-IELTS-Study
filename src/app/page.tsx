import { Dashboard } from "@/components/dashboard";
import { getDashboardSnapshot } from "@/server/store";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Dashboard initial={getDashboardSnapshot()} />;
}
