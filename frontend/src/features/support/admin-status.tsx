"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { useState } from "react";

import { PageContainer } from "@/components/app/page-container";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";

import { AdminNav } from "./admin-nav";
import { ago } from "./parts";

/** Mirrors backend/app/status.py and support_schemas.Incident*. */
export const COMPONENTS = [
  ["api", "API"],
  ["database", "Database"],
  ["jobs", "Background jobs"],
  ["storage", "File storage"],
] as const;
type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
type Incident = {
  id: string;
  title: string;
  impact: "minor" | "major" | "maintenance";
  status: IncidentStatus;
  components: string[];
  created_at: string;
  resolved_at: string | null;
  updates: { id: string; status: IncidentStatus; message: string; created_at: string }[];
};
const STATUSES: IncidentStatus[] = ["investigating", "identified", "monitoring", "resolved"];
const KEY = ["status", "admin", "incidents"];

function useIncidents() {
  return useQuery({ queryKey: KEY, queryFn: () => api<Incident[]>("/status/admin/incidents") });
}

function NewIncident({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [impact, setImpact] = useState<Incident["impact"]>("minor");
  const [components, setComponents] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const create = useMutation({
    mutationFn: () => api<Incident>("/status/admin/incidents", { method: "POST", body: JSON.stringify({ title, impact, components, message }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      onDone();
    },
  });
  return (
    <Panel>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Field>
          <FieldLabel htmlFor="inc-title">What&apos;s happening</FieldLabel>
          <Input id="inc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Uploads are slow" required minLength={3} maxLength={200} />
        </Field>
        <div className="flex flex-wrap gap-6">
          <label className="flex flex-col gap-1 text-[13px] text-faint">
            Impact
            <NativeSelect value={impact} onChange={(e) => setImpact(e.target.value as Incident["impact"])}>
              <NativeSelectOption value="minor">Degraded</NativeSelectOption>
              <NativeSelectOption value="major">Outage</NativeSelectOption>
              <NativeSelectOption value="maintenance">Maintenance</NativeSelectOption>
            </NativeSelect>
          </label>
          <fieldset className="flex flex-col gap-1.5 text-[13px] text-faint">
            <legend className="mb-1">Affected</legend>
            <div className="flex flex-wrap gap-4">
              {COMPONENTS.map(([id, name]) => (
                <label key={id} className="flex items-center gap-2 text-text">
                  <Checkbox
                    checked={components.includes(id)}
                    onCheckedChange={(v) => setComponents((c) => (v ? [...c, id] : c.filter((x) => x !== id)))}
                  />
                  {name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <Field>
          <FieldLabel htmlFor="inc-msg">First update (public)</FieldLabel>
          <Textarea id="inc-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} required minLength={3} placeholder="We're looking into slow uploads." />
        </Field>
        {create.error && <p className="text-[13px] text-destructive">{create.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Post incident
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function IncidentCard({ inc }: { inc: Incident }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<IncidentStatus>(inc.status === "resolved" ? "resolved" : inc.status);
  const [message, setMessage] = useState("");
  const update = useMutation({
    mutationFn: () => api<Incident>(`/status/admin/incidents/${inc.id}/updates`, { method: "POST", body: JSON.stringify({ status, message }) }),
    onSuccess: () => {
      setMessage("");
      qc.invalidateQueries({ queryKey: KEY });
    },
  });
  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-text">{inc.title}</p>
        <Badge variant={inc.status === "resolved" ? "success-light" : inc.impact === "major" ? "destructive-light" : "warning-light"} radius="full" size="lg">
          {inc.status}
        </Badge>
      </div>
      <ol className="flex flex-col gap-2 border-l border-line pl-4 text-[13.5px]">
        {inc.updates.map((u) => (
          <li key={u.id}>
            <span className="font-medium capitalize text-text">{u.status}</span> <span className="text-faint">· {ago(u.created_at)}</span>
            <p className="text-muted">{u.message}</p>
          </li>
        ))}
      </ol>
      {inc.status !== "resolved" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          <NativeSelect size="sm" value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus)} aria-label="New status">
            {STATUSES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {s}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Post an update" className="min-w-[220px] flex-1" minLength={3} required />
          <Button type="submit" size="sm" disabled={update.isPending}>
            Update
          </Button>
        </form>
      )}
    </Panel>
  );
}

export function AdminStatus() {
  const { data: incidents } = useIncidents();
  const [creating, setCreating] = useState(false);
  return (
    <PageContainer>
      <PageHeader
        title="Status & incidents"
        description="Health checks run every minute on their own. Post an incident when people are affected, and keep it updated until it's resolved."
        actions={
          <>
            <Button variant="outline" nativeButton={false} render={<a href="/status" target="_blank" rel="noreferrer" />}>
              <ExternalLink aria-hidden /> Public page
            </Button>
            {!creating && (
              <Button onClick={() => setCreating(true)}>
                <Plus aria-hidden /> New incident
              </Button>
            )}
          </>
        }
      />
      <AdminNav />
      {creating && <NewIncident onDone={() => setCreating(false)} />}
      <div className="flex flex-col gap-3">
        {incidents?.map((i) => <IncidentCard key={i.id} inc={i} />)}
        {incidents?.length === 0 && !creating && <p className="text-[14px] text-muted">No incidents posted. Long may it last.</p>}
      </div>
    </PageContainer>
  );
}
