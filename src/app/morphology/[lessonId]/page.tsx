import { MorphologyWorkspace } from "@/components/morphology-workspace";

export default async function MorphologyLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await params;
  return <MorphologyWorkspace key={lessonId} initialLessonId={lessonId} />;
}
