"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt, Rocket, ShoppingBag, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useMe } from "@/features/auth/hooks";
import type { Dashboard } from "@/features/dashboards/api";
import { dashboardKeys } from "@/features/dashboards/hooks";
import { useDatasets } from "@/features/datasets/api";
import { api } from "@/lib/api/client";

type TemplateField = { key: string; label: string; type: "number" | "date" | "category"; required: boolean };
type Template = { id: string; name: string; description: string; fields: TemplateField[]; charts: string[] };

const ICON: Record<string, LucideIcon> = { sales: ShoppingBag, startup: Rocket, expenses: Receipt };
const OK_TYPES: Record<TemplateField["type"], string[]> = { number: ["number"], date: ["date"], category: ["category", "text"] };

function UseTemplateDialog({ template }: { template: Template }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: datasets } = useDatasets();
  const [open, setOpen] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [name, setName] = useState("");
  const [state, setState] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });

  useEffect(() => {
    if (open && !datasetId && datasets?.[0]) setDatasetId(datasets[0].id);
  }, [open, datasets, datasetId]);

  // Pre-fill the mapping from the server's suggestion whenever the dataset changes.
  const suggestion = useQuery({
    queryKey: ["templates", template.id, "suggest", datasetId],
    queryFn: () => api<Record<string, string | null>>(`/templates/${template.id}/suggest?dataset_id=${datasetId}`),
    enabled: open && !!datasetId,
  });
  useEffect(() => {
    if (suggestion.data) setMapping(suggestion.data);
  }, [suggestion.data]);

  const ds = datasets?.find((d) => d.id === datasetId);
  const missing = template.fields.filter((f) => f.required && !mapping[f.key]);

  const apply = async () => {
    setState({ saving: true, error: null });
    try {
      const d = await api<Dashboard>(`/templates/${template.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ dataset_id: datasetId, mapping, name: name.trim() || null }),
      });
      qc.setQueryData(dashboardKeys.detail(d.id), d);
      void qc.invalidateQueries({ queryKey: dashboardKeys.all, exact: true });
      router.push(`/dashboards/${d.id}`);
    } catch (e) {
      setState({ saving: false, error: e instanceof Error ? e.message : "Couldn't create the dashboard" });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setState({ saving: false, error: null });
      }}
    >
      <DialogTrigger render={<Button className="self-start" />}>Use template</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template.name} template</DialogTitle>
          <DialogDescription>Tell us which of your columns is which. We&apos;ve guessed from their names and types.</DialogDescription>
        </DialogHeader>
        {!datasets?.length ? (
          <p className="text-sm text-muted">
            Add a dataset first on the{" "}
            <Link href="/data" className="text-highlight underline">
              Data page
            </Link>
            .
          </p>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void apply();
            }}
          >
            <Field>
              <FieldLabel htmlFor="tpl-ds">Dataset</FieldLabel>
              <NativeSelect id="tpl-ds" className="w-full" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id} className="bg-surface">
                    {d.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {template.fields.map((f) => {
                const options = ds?.columns.filter((c) => OK_TYPES[f.type].includes(c.type)) ?? [];
                return (
                  <Field key={f.key}>
                    <FieldLabel htmlFor={`tpl-${f.key}`}>
                      {f.label}
                      {f.required ? <span className="text-accent" aria-hidden> *</span> : <span className="font-normal text-faint"> (optional)</span>}
                    </FieldLabel>
                    <NativeSelect
 id={`tpl-${f.key}`}
                      className="w-full"
                      value={mapping[f.key] ?? ""}
                      onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value || null }))}
                    >
                      <option value="" className="bg-surface">
                        {f.required ? "Pick a column…" : "Skip"}
                      </option>
                      {options.map((c) => (
                        <option key={c.name} value={c.name} className="bg-surface">
                          {c.name}
                        </option>
                      ))}
                    </NativeSelect>
                    {!options.length && <FieldDescription>No {f.type} column in this dataset.</FieldDescription>}
                  </Field>
                );
              })}
            </div>
            <Field>
              <FieldLabel htmlFor="tpl-name">Dashboard name</FieldLabel>
              <Input id="tpl-name" maxLength={200} placeholder={`${template.name} · ${ds?.name ?? ""}`} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {state.error && <p className="text-[13px] text-accent">{state.error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={state.saving || missing.length > 0 || !datasetId}>
                {state.saving ? "Creating…" : "Create dashboard"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TemplatesScreen() {
  const { data: me } = useMe();
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api<Template[]>("/templates"), staleTime: Infinity });

  return (
    <PageContainer>
      <PageHeader
        title="Templates"
        description="Ready-made dashboards for common questions. Map your columns once and get the whole set of charts."
      />
      {templates.isError && <p className="text-sm text-accent">{templates.error.message}</p>}
      <ul className="grid gap-4 md:grid-cols-3">
        {(templates.data ?? []).map((t) => {
          const Icon = ICON[t.id] ?? ShoppingBag;
          return (
            <li key={t.id} className="flex flex-col gap-4 rounded-[18px] border border-line bg-surface p-6">
              <Icon className="size-7 text-highlight" strokeWidth={1.6} aria-hidden />
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">{t.name}</h2>
                <p className="text-sm text-muted">{t.description}</p>
              </div>
              <ul className="flex flex-1 flex-col gap-1.5 text-[13px] text-faint">
                {t.charts.map((c) => (
                  <li key={c} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                    {c}
                  </li>
                ))}
              </ul>
              {me?.role !== "viewer" && <UseTemplateDialog template={t} />}
            </li>
          );
        })}
        {templates.isPending && [0, 1, 2].map((i) => <li key={i} className="h-80 animate-pulse rounded-[18px] bg-surface" />)}
      </ul>
    </PageContainer>
  );
}
