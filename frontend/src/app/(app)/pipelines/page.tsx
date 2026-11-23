import type { Metadata } from "next";

import { PipelinesList } from "@/features/pipelines/pipelines-screens";

export const metadata: Metadata = { title: "Pipelines" };

export default function PipelinesPage() {
  return <PipelinesList />;
}
