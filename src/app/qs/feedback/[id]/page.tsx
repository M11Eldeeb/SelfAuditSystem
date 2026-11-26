import { FeedbackThreadPage } from "@/components/feedback/sender-pages";

export default async function FeedbackThread({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FeedbackThreadPage basePath="/qs/feedback" id={id} />;
}
