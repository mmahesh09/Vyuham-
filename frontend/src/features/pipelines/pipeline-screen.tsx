"use client";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { usePipeline } from "@/features/platform/api";

import { PipelineEditor } from "./pipeline-editor";

export function PipelineScreen({ id }: { id: string }) {
  const p = usePipeline(id);
  return (
    <PageContainer width="wide">
      <PageHeader title={p.data?.name ?? "Pipeline"} crumb={p.data?.name} back={{ href: "/pipelines", label: "Pipelines" }} />
      <PipelineEditor pipelineId={id} />
    </PageContainer>
  );
}
