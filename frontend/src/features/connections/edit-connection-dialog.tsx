"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { InlineAlert } from "@/components/app/inline-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { KIND_LABEL, useTestConnection, useUpdateConnection, type Connection, type SslMode } from "./api";

const SSL_STRENGTH: Record<SslMode, number> = { disable: 0, require: 1, "verify-full": 2 };

type Form = { name: string; host: string; port: string; database: string; username: string; password: string; ssl_mode: SslMode };

function formFor(c: Connection): Form {
  return { name: c.name, host: c.host, port: String(c.port), database: c.database, username: c.username, password: "", ssl_mode: c.ssl_mode };
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Change a saved connection, for example after its password was rotated. */
export function EditConnectionDialog({
  connection,
  open,
  onOpenChange,
}: {
  connection: Connection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<Form>(() => formFor(connection));
  const test = useTestConnection();
  const update = useUpdateConnection(connection.id);

  useEffect(() => {
    if (!open) return;
    setForm(formFor(connection));
    test.reset();
    update.reset();
    // Start from the saved values each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection.id]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    test.reset();
    update.reset();
  };

  const fields = {
    kind: connection.kind,
    host: form.host.trim(),
    port: Number(form.port),
    database: form.database.trim(),
    username: form.username.trim(),
    ssl_mode: form.ssl_mode,
  };
  // The server refuses to send a saved password to a new address or over weaker SSL.
  const passwordRequired =
    fields.host.toLowerCase() !== connection.host.toLowerCase() ||
    fields.port !== connection.port ||
    SSL_STRENGTH[fields.ssl_mode] < SSL_STRENGTH[connection.ssl_mode];
  const complete = Boolean(form.name.trim() && fields.host && fields.port && fields.database && fields.username && (form.password || !passwordRequired));

  function save() {
    update.mutate(
      {
        name: form.name.trim(),
        host: fields.host,
        port: fields.port,
        database: fields.database,
        username: fields.username,
        ssl_mode: fields.ssl_mode,
        ...(form.password ? { password: form.password } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {KIND_LABEL[connection.kind]} connection</DialogTitle>
          <DialogDescription>We check the new details before saving them. Your datasets stay connected.</DialogDescription>
        </DialogHeader>

        {connection.status === "error" && connection.last_error && <InlineAlert>{connection.last_error}</InlineAlert>}

        <div className="flex flex-col gap-4">
          <Field id="edit-name" label="Name in Vyuham">
            <Input id="edit-name" value={form.name} maxLength={120} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Field id="edit-host" label="Host">
              <Input id="edit-host" value={form.host} onChange={(e) => set("host", e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field id="edit-port" label="Port">
              <Input id="edit-port" inputMode="numeric" value={form.port} onChange={(e) => set("port", e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-database" label="Database">
              <Input id="edit-database" value={form.database} onChange={(e) => set("database", e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field id="edit-ssl" label="SSL">
              <NativeSelect id="edit-ssl" value={form.ssl_mode} onChange={(e) => set("ssl_mode", e.target.value as SslMode)}>
                <option value="require">Require (recommended)</option>
                <option value="verify-full">Verify certificate</option>
                <option value="disable">Off</option>
              </NativeSelect>
            </Field>
            <Field id="edit-user" label="Username">
              <Input id="edit-user" value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field id="edit-pass" label="Password">
              <Input
                id="edit-pass"
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder={passwordRequired ? "Required for this change" : "Keep the saved password"}
                autoComplete="new-password"
              />
            </Field>
          </div>
          {form.ssl_mode === "disable" && (
            <p className="text-[13px] text-accent">With SSL off, your password and data travel unencrypted.</p>
          )}
        </div>

        <div aria-live="polite" className="empty:hidden">
          {test.data && <InlineAlert tone={test.data.ok ? "info" : undefined}>{test.data.message}</InlineAlert>}
          {test.isError && <InlineAlert>{test.error.message}</InlineAlert>}
          {update.isError && <InlineAlert>{update.error.message}</InlineAlert>}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => test.mutate({ ...fields, password: form.password, connection_id: connection.id })}
            disabled={!complete || test.isPending}
          >
            {test.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {test.isPending ? "Testing…" : "Test connection"}
          </Button>
          <Button onClick={save} disabled={!complete || update.isPending}>
            {update.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {update.isPending ? "Checking…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
