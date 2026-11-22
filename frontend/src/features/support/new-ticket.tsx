"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";

import { GuidedRequest } from "./request-flow";

export function NewTicket() {
  const router = useRouter();
  const from = useSearchParams().get("from");

  return (
    <PageContainer width="narrow">
      <PageHeader
        back={{ href: "/support", label: "Help & support" }}
        title="New request"
        description="Tell us what's going on. A person on the team reads every request and replies here and by email."
      />
      <GuidedRequest
        pageUrl={from && from.startsWith("/") ? from.slice(0, 500) : undefined}
        onSent={(t) => router.push(`/support/${t.id}`)}
      />
    </PageContainer>
  );
}
