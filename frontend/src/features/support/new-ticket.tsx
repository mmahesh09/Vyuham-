"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useDebounced } from "@/lib/use-debounced";

import { CATEGORY_LABEL, logDeflection, useArticleSearch, useCreateTicket, type Category } from "./api";

const EVENT_ID = /^[A-Za-z0-9-]{1,64}$/;

export function NewTicket() {
  const router = useRouter();
  const params = useSearchParams();
  const errorRef = params.get("error");
  const eventId = errorRef && EVENT_ID.test(errorRef) ? errorRef : undefined;
  const from = params.get("from");

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>(eventId ? "bug" : "question");
  const create = useCreateTicket();

  // Deflection: while they type the subject, show articles that may already answer it.
  const query = useDebounced(subject, 350);
  const { data: suggestions } = useArticleSearch(query);

  const valid = subject.trim().length >= 3 && body.trim().length >= 10;

  return (
    <PageContainer width="narrow">
      <PageHeader
        back={{ href: "/support", label: "Help & support" }}
        title="New request"
        description="Tell us what you were doing and what happened. A real person reads every request."
      />

      <form
        className="flex flex-col gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          const t = await create
            .mutateAsync({
              subject: subject.trim(),
              body: body.trim(),
              category,
              error_event_id: eventId,
              page_url: from && from.startsWith("/") ? from.slice(0, 500) : undefined,
            })
            .catch(() => null);
          if (t) router.push(`/support/${t.id}`);
        }}
      >
        <Field>
          <FieldLabel htmlFor="subject">What do you need help with?</FieldLabel>
          <Input
            id="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. My revenue chart shows zero after uploading"
            maxLength={200}
            required
            autoFocus
          />
        </Field>

        {!!suggestions?.length && subject.trim().length >= 4 && (
          <Panel className="flex flex-col gap-3 border-highlight/30 bg-highlight/5">
            <p className="flex items-center gap-2 text-[14px] font-medium text-text">
              <BookOpen className="size-4 text-highlight" aria-hidden /> These might answer it right away
            </p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/help/${a.slug}`}
                    target="_blank"
                    onClick={() => logDeflection(a.id)}
                    className="group flex flex-col rounded-lg px-1 py-1 hover:bg-surface-2"
                  >
                    <span className="text-[14.5px] font-medium text-highlight group-hover:underline">{a.title}</span>
                    {a.summary && <span className="text-[13px] text-muted">{a.summary}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Field>
          <FieldLabel htmlFor="category">Type</FieldLabel>
          <NativeSelect id="category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
              <NativeSelectOption key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="body">Details</FieldLabel>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={10_000}
            placeholder="What did you do, what did you expect, and what happened instead? Which dashboard or file?"
            required
          />
          <FieldDescription>
            {eventId ? (
              <>
                We&apos;ll attach the error reference <code className="font-mono text-[12px]">{eventId}</code> so we can see exactly what failed.
              </>
            ) : (
              "Don't paste passwords or card numbers."
            )}
          </FieldDescription>
        </Field>

        {create.error && (
          <p role="alert" className="text-[14px] text-destructive">
            {create.error.message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || create.isPending}>
            {create.isPending ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </PageContainer>
  );
}
