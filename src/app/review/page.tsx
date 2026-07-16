import { ReviewWorkspace } from "@/components/review-workspace";
import { listReviewItems } from "@/server/store";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return <ReviewWorkspace initialItems={listReviewItems()} />;
}

