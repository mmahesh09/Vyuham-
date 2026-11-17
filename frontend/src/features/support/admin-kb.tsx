"use client";

import { BookOpen, ExternalLink, Plus, Trash2 } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/app/empty-state";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel, PanelRow } from "@/components/app/panel";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { AdminNav } from "./admin-nav";
import { useArticle, useArticles, useDeleteArticle, useSaveArticle, type ArticleInput } from "./api";
import { ago } from "./parts";

const EMPTY: ArticleInput = { title: "", summary: "", body: "", tags: [], status: "draft" };

function Editor({ id, onDone }: { id: string | null; onDone: () => void }) {
  const { data: existing } = useArticle(id);
  const save = useSaveArticle();
  const del = useDeleteArticle();
  const [form, setForm] = useState<ArticleInput>(EMPTY);
  const [tags, setTags] = useState("");

  useEffect(() => {
    if (existing) {
      setForm({ title: existing.title, summary: existing.summary, body: existing.body, tags: existing.tags, status: existing.status, slug: existing.slug });
      setTags(existing.tags.join(", "));
    } else if (!id) {
      setForm(EMPTY);
      setTags("");
    }
  }, [existing, id]);

  const set = <K extends keyof ArticleInput>(k: K, v: ArticleInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = { ...form, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) };
        const saved = await save.mutateAsync({ ...body, id: id ?? undefined }).catch(() => null);
        if (saved) onDone();
      }}
    >
      <Field>
        <FieldLabel htmlFor="kb-title">Title</FieldLabel>
        <Input id="kb-title" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={200} required placeholder="Your chart shows zero after a re-upload" />
      </Field>
      <Field>
        <FieldLabel htmlFor="kb-summary">One-line summary</FieldLabel>
        <Input id="kb-summary" value={form.summary} onChange={(e) => set("summary", e.target.value)} maxLength={300} placeholder="Shown in search results and on the error screen" />
      </Field>
      <Field>
        <FieldLabel htmlFor="kb-body">Article (Markdown)</FieldLabel>
        <Textarea id="kb-body" value={form.body} onChange={(e) => set("body", e.target.value)} rows={16} className="font-mono text-[13px]" maxLength={100_000} />
        <FieldDescription>Headings, lists, links, tables and code blocks. HTML is not rendered.</FieldDescription>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="kb-tags">Tags</FieldLabel>
          <Input id="kb-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="uploads, charts" />
        </Field>
        <Field>
          <FieldLabel htmlFor="kb-slug">Address</FieldLabel>
          <Input
            id="kb-slug"
            value={form.slug ?? ""}
            onChange={(e) => set("slug", e.target.value || undefined)}
            placeholder="made from the title"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <FieldDescription>/help/{form.slug || "…"}</FieldDescription>
        </Field>
      </div>
      <label className="flex items-center gap-3 text-[14px] text-text">
        <Switch checked={form.status === "published"} onCheckedChange={(v) => set("status", v ? "published" : "draft")} />
        Published (visible to everyone in the help center)
      </label>
      {(save.error || del.error) && (
        <p role="alert" className="text-[13px] text-destructive">
          {(save.error ?? del.error)?.message}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex gap-2">
          {id && (
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!window.confirm("Delete this article? Links to it from errors and tickets are removed.")) return;
                await del.mutateAsync(id).catch(() => null);
                onDone();
              }}
            >
              <Trash2 aria-hidden /> Delete
            </Button>
          )}
          {existing?.status === "published" && (
            <Button type="button" variant="outline" nativeButton={false} render={<a href={`/help/${existing.slug}`} target="_blank" rel="noreferrer" />}>
              <ExternalLink aria-hidden /> View
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || form.title.trim().length < 3}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function AdminKb() {
  const [edit, setEdit] = useQueryState("edit", parseAsString);
  const { data: articles, isLoading } = useArticles();
  const editing = edit !== null;

  return (
    <PageContainer>
      <PageHeader
        title="Help articles"
        description="The public help center. Every fix you write here answers the next person before they need to ask."
        actions={
          !editing && (
            <Button onClick={() => setEdit("new")}>
              <Plus aria-hidden /> New article
            </Button>
          )
        }
      />
      <AdminNav />
      {editing ? (
        <Panel>
          <Editor id={edit === "new" ? null : edit} onDone={() => setEdit(null)} />
        </Panel>
      ) : isLoading ? (
        <Skeleton className="h-60 rounded-xl" />
      ) : !articles?.length ? (
        <EmptyState icon={<BookOpen />} title="No articles yet" description="Write one, or turn a solved ticket into one from the inbox." />
      ) : (
        <Panel variant="list">
          {articles.map((a) => (
            <PanelRow key={a.id} interactive className="p-0">
              <button type="button" onClick={() => setEdit(a.id)} className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium text-text">{a.title}</span>
                  <span className="text-[13px] text-faint">
                    /help/{a.slug} · {a.views} views · 👍 {a.helpful_yes} 👎 {a.helpful_no} · updated {ago(a.updated_at)}
                  </span>
                </span>
                <Badge variant={a.status === "published" ? "success-light" : "invert-light"} radius="full" size="lg">
                  {a.status}
                </Badge>
              </button>
            </PanelRow>
          ))}
        </Panel>
      )}
    </PageContainer>
  );
}
