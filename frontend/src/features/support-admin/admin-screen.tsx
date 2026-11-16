"use client";

import { ShieldCheck } from "lucide-react";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";

import { Badge } from "@/components/reui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { SupportRole } from "./api";
import { ErrorsTab } from "./errors-tab";
import { KnowledgeTab } from "./knowledge-tab";
import { AuditTab, FeedbackTab, SuggestionsTab, TicketsTab } from "./other-tabs";
import { OverviewTab } from "./overview-tab";

const TABS = ["overview", "errors", "knowledge", "suggestions", "feedback", "tickets", "audit"] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = { overview: "Overview", errors: "Errors", knowledge: "Knowledge", suggestions: "AI suggestions", feedback: "Feedback", tickets: "Tickets", audit: "Audit log" };

export function SupportAdminScreen({ role, email }: { role: SupportRole; email: string }) {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(TABS).withDefault("overview"));
  const [days, setDays] = useQueryState("days", parseAsInteger.withDefault(30));
  const [fingerprint, setFingerprint] = useState<string | undefined>();

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="flex items-center gap-3 text-[38px] font-semibold tracking-[-0.03em]">
            <ShieldCheck className="size-8 text-highlight" strokeWidth={1.8} aria-hidden /> Support admin
          </h1>
          <p className="text-[15px] text-muted">
            Internal to Vyuham. Signed in as {email} <Badge variant={role === "admin" ? "primary-light" : "secondary"}>{role === "admin" ? "Administrator" : "Support staff"}</Badge>
          </p>
        </div>
        <NativeSelect value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
          <NativeSelectOption value="7">Last 7 days</NativeSelectOption>
          <NativeSelectOption value="30">Last 30 days</NativeSelectOption>
          <NativeSelectOption value="90">Last 90 days</NativeSelectOption>
        </NativeSelect>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])} className="flex flex-col gap-5">
        <div className="overflow-x-auto">
          <TabsList>{TABS.map((t) => <TabsTrigger key={t} value={t}>{TAB_LABEL[t]}</TabsTrigger>)}</TabsList>
        </div>
        <TabsContent value="overview"><OverviewTab days={days} onOpenFingerprint={(fp) => (setFingerprint(fp), setTab("errors"))} /></TabsContent>
        <TabsContent value="errors"><ErrorsTab fingerprint={fingerprint} clearFingerprint={() => setFingerprint(undefined)} /></TabsContent>
        <TabsContent value="knowledge"><KnowledgeTab role={role} /></TabsContent>
        <TabsContent value="suggestions"><SuggestionsTab /></TabsContent>
        <TabsContent value="feedback"><FeedbackTab days={days} /></TabsContent>
        <TabsContent value="tickets"><TicketsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
    </div>
  );
}
