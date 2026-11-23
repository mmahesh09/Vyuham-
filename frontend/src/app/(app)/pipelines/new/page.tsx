import type { Metadata } from "next";

import { NewPipeline } from "@/features/pipelines/pipelines-screens";

export const metadata: Metadata = { title: "New pipeline" };

export default async function NewPipelinePage({ searchParams }: { searchParams: Promise<{ ai?: string }> }) {
  const { ai } = await searchParams;
  return <NewPipeline ai={ai === "1"} />;
}
