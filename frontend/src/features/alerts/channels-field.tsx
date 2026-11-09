"use client";

import { Bell, Mail, Webhook } from "lucide-react";

import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import type { Channels } from "./api";

/** How to deliver: in-app bell, email addresses, and/or a webhook (Slack, Teams, Zapier…). */
export function ChannelsField({ value, onChange }: { value: Channels; onChange: (v: Channels) => void }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">Notify by</legend>
      <label className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={value.inapp} onChange={(e) => onChange({ ...value, inapp: e.target.checked })} />
        <Bell className="size-4 text-highlight" aria-hidden />
        In-app notification for everyone in the workspace
      </label>
      <Field>
        <label htmlFor="ch-emails" className="flex items-center gap-2 text-sm">
          <Mail className="size-4 text-highlight" aria-hidden /> Email
        </label>
        <Input
          id="ch-emails"
          placeholder="ana@company.com, ravi@company.com"
          value={value.emails.join(", ")}
          onChange={(e) => onChange({ ...value, emails: e.target.value.split(/[,\s]+/).filter(Boolean) })}
        />
        <FieldDescription>Comma-separated. Emails are written to the server log until an email provider is connected.</FieldDescription>
      </Field>
      <Field>
        <label htmlFor="ch-webhook" className="flex items-center gap-2 text-sm">
          <Webhook className="size-4 text-highlight" aria-hidden /> Webhook
        </label>
        <Input
          id="ch-webhook"
          type="url"
          placeholder="https://hooks.slack.com/services/…"
          value={value.webhook ?? ""}
          onChange={(e) => onChange({ ...value, webhook: e.target.value.trim() || null })}
        />
        <FieldDescription>A Slack or Microsoft Teams incoming webhook, or a Zapier/Make URL. Must be https.</FieldDescription>
      </Field>
    </fieldset>
  );
}
