import type { Metadata } from "next";

import { PipelineScreen } from "@/features/pipelines/pipeline-screen";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PipelineScreen id={id} />;
}
