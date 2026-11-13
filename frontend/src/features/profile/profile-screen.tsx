"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BellRing, CalendarClock, Check, Globe, HelpCircle, Mail, Users } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";

import { PageContainer } from "@/components/app/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/reui/badge";
import { PhoneInput } from "@/components/reui/phone-input";
import { TimePicker } from "@/components/reui/time-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMe } from "@/features/auth/hooks";
import { StatusCard } from "@/features/presence/status-card";
import { StatusMenu } from "@/features/presence/status-menu";
import type { User } from "@/lib/api/client";
import { cn } from "@/lib/utils";

import { AccountPanel } from "./account-panel";
import { ActivityTimeline } from "./activity-timeline";
import { useActivity, useMembers, useProfile, useSaveProfile, type Profile } from "./api";
import { FeedbackCard } from "./feedback-card";
import { profileSchema, ROLE_MAX, type ProfileForm } from "./schema";
import { SignatureField } from "./signature-field";
import { TeamStatusPopover } from "./team-status-popover";
import { initials, TeamTree } from "./team-tree";

const ROLE_LABEL: Record<User["role"], string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

const VISIBILITY = [
  {
    value: "team",
    label: "Team members only",
    help: "Only people in this workspace can open your dashboards.",
    icon: Users,
  },
  {
    value: "anyone",
    label: "Anyone with the link",
    help: "Anyone you send the link to can view your dashboards, even without an account. They can't edit.",
    icon: Globe,
  },
] as const;

const NOTIFICATIONS = [
  { name: "notify_email", title: "Activity emails", description: "When someone shares or changes a dashboard you use", icon: Mail },
  { name: "notify_weekly", title: "Weekly digest", description: "A Monday summary of what moved in your numbers", icon: BellRing },
] as const;

function toForm(user: User, profile: Profile | undefined): ProfileForm {
  return {
    name: user.name,
    job_role: profile?.job_role ?? "",
    phone: profile?.phone ?? "",
    timezone: profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    work_start: profile?.work_start ?? "09:00",
    work_end: profile?.work_end ?? "18:00",
    signature: profile?.signature ?? null,
    dashboard_visibility: profile?.dashboard_visibility ?? "team",
    notify_email: profile?.notify_email ?? true,
    notify_weekly: profile?.notify_weekly ?? true,
  };
}

/** Fraction of the optional-but-useful details that are filled in. */
function completeness(v: ProfileForm) {
  const checks = [v.name, v.job_role.trim().length >= 2, v.phone, v.timezone, v.work_start && v.work_end, v.signature];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function ProfileScreen() {
  const { data: user } = useMe();
  const profile = useProfile();
  if (!user || profile.isPending) return <ProfileSkeleton />;
  if (profile.isError) return <p className="text-accent">Couldn&apos;t load your profile: {profile.error.message}</p>;
  return <ProfileEditor user={user} profile={profile.data} />;
}

function ProfileEditor({ user, profile }: { user: User; profile: Profile }) {
  const save = useSaveProfile();
  const members = useMembers();
  const activity = useActivity();
  const roleRef = useRef<HTMLTextAreaElement | null>(null);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [Intl.DateTimeFormat().resolvedOptions().timeZone];
    }
  }, []);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema) as Resolver<ProfileForm>,
    defaultValues: toForm(user, profile),
    mode: "onTouched",
  });
  const { register, control, handleSubmit, formState, reset } = form;
  const values = useWatch({ control }) as ProfileForm;
  const roleLength = values.job_role?.length ?? 0;
  const needsRole = !profile.job_role;

  // Auto-resize the role textarea (ReUI c-textarea-6).
  const roleField = register("job_role");
  const resizeRole = () => {
    const el = roleRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(resizeRole, []);

  const onSubmit = handleSubmit((v) =>
    save.mutate(
      {
        name: v.name.trim(),
        profile: {
          job_role: v.job_role.trim(),
          phone: v.phone || null,
          timezone: v.timezone || null,
          work_start: v.work_start,
          work_end: v.work_end,
          signature: v.signature,
          dashboard_visibility: v.dashboard_visibility,
          notify_email: v.notify_email,
          notify_weekly: v.notify_weekly,
        },
      },
      { onSuccess: () => reset(v) },
    ),
  );

  const pct = completeness(values);

  return (
    <TooltipProvider>
      {/* A div, not a <form>: the leave and feedback forms live inside it and forms can't nest. */}
      <PageContainer className="gap-6 pb-24">
        {/* ---------- Header ---------- */}
        <section className="flex flex-col gap-6 rounded-2xl border border-line bg-surface p-6 md:flex-row md:items-center">
          <StatusMenu initials={initials(values.name || user.name)} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="type-page-title truncate text-text">{values.name || user.name}</h1>
              <Badge variant="primary-light">{ROLE_LABEL[user.role]}</Badge>
            </div>
            <p className={cn("line-clamp-2 text-[15px]", values.job_role ? "text-muted" : "text-accent")}>
              {values.job_role || "Add your role so teammates know what you own"}
            </p>
            <p className="text-[13px] text-faint">
              {user.email} · {user.workspace.name}
            </p>
            <TeamStatusPopover />
          </div>
          <div className="flex w-full flex-col gap-2 md:w-56">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted">Profile complete</span>
              <span className="font-semibold tabular-nums text-highlight">{pct}%</span>
            </div>
            <Progress value={pct} aria-label="Profile completeness" />
          </div>
        </section>

        {needsRole && (
          <p role="note" className="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-text">
            Your <strong>role</strong> is required. It shows next to your name across the team view and on shared dashboards.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* ---------- Left column ---------- */}
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>About you</CardTitle>
                <CardDescription>How you appear to the people in {user.workspace.name}.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field data-invalid={formState.errors.name ? true : undefined}>
                    <FieldLabel htmlFor="name">Full name</FieldLabel>
                    <Input id="name" autoComplete="name" aria-invalid={!!formState.errors.name} {...register("name")} />
                    {formState.errors.name && <p className="text-[13px] text-accent">{formState.errors.name.message}</p>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="email">Email</FieldLabel>
                    <Input id="email" value={user.email} readOnly disabled />
                    <FieldDescription>Used to sign in. Can&apos;t be changed yet.</FieldDescription>
                  </Field>
                </div>

                <Field data-invalid={formState.errors.job_role ? true : undefined}>
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="job_role">
                      Your role <span className="text-accent" aria-hidden>*</span>
                    </FieldLabel>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        roleLength >= ROLE_MAX ? "font-semibold text-accent" : roleLength > ROLE_MAX - 20 ? "text-warning" : "text-faint",
                      )}
                    >
                      {roleLength}/{ROLE_MAX}
                    </span>
                  </div>
                  <Textarea
                    id="job_role"
                    rows={2}
                    maxLength={ROLE_MAX}
                    required
                    aria-required
                    aria-invalid={!!formState.errors.job_role}
                    aria-describedby="job_role-hint"
                    placeholder="e.g. Finance lead — owns monthly reporting and the cash-flow dashboard"
                    className="resize-none overflow-hidden"
                    {...roleField}
                    ref={(el) => {
                      roleField.ref(el);
                      roleRef.current = el;
                    }}
                    onChange={(e) => {
                      roleField.onChange(e);
                      resizeRole();
                    }}
                  />
                  {formState.errors.job_role ? (
                    <p className="text-[13px] text-accent">{formState.errors.job_role.message}</p>
                  ) : (
                    <FieldDescription id="job_role-hint">What you do and what you&apos;re responsible for.</FieldDescription>
                  )}
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field data-invalid={formState.errors.phone ? true : undefined}>
                    <FieldLabel htmlFor="phone">Phone</FieldLabel>
                    <Controller
                      control={control}
                      name="phone"
                      render={({ field, fieldState }) => (
                        <PhoneInput
                          id="phone"
                          defaultCountry="IN"
                          international
                          placeholder="Enter phone number"
                          value={field.value}
                          onChange={(v) => field.onChange(v ?? "")}
                          onBlur={field.onBlur}
                          aria-invalid={fieldState.invalid ? "true" : undefined}
                        />
                      )}
                    />
                    {formState.errors.phone && <p className="text-[13px] text-accent">{formState.errors.phone.message}</p>}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
                    <select
                      id="timezone"
                      {...register("timezone")}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-text focus-visible:border-ring focus-visible:outline-none"
                    >
                      {/* Browsers disagree on aliases (Asia/Kolkata vs Asia/Calcutta): always offer the saved one. */}
                      {(values.timezone && !timezones.includes(values.timezone) ? [values.timezone, ...timezones] : timezones).map((tz) => (
                        <option key={tz} value={tz} className="bg-surface">
                          {tz.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarClock className="size-4 text-highlight" aria-hidden /> Working hours
                </CardTitle>
                <CardDescription>Teammates see when you&apos;re usually around. Alerts outside these hours wait until morning.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5 sm:grid-cols-2">
                {(["work_start", "work_end"] as const).map((name) => (
                  <Field key={name}>
                    <FieldLabel htmlFor={name}>{name === "work_start" ? "Start" : "End"}</FieldLabel>
                    <Controller
                      control={control}
                      name={name}
                      render={({ field }) => (
                        <TimePicker
                          id={name}
                          value={field.value}
                          onValueChange={field.onChange}
                          hourCycle={12}
                          minuteStep={15}
                          placeholder="Pick a time"
                          className="w-full justify-between"
                        />
                      )}
                    />
                  </Field>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Signature</CardTitle>
                <CardDescription>Added when you approve or sign off a report.</CardDescription>
              </CardHeader>
              <CardContent>
                <Controller
                  control={control}
                  name="signature"
                  render={({ field }) => <SignatureField value={field.value} onChange={field.onChange} signerName={values.name || user.name} />}
                />
              </CardContent>
            </Card>

            <Card id="dashboard-sharing" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Dashboard sharing</CardTitle>
                <CardDescription>Who can open the dashboards you create.</CardDescription>
              </CardHeader>
              <CardContent>
                <Controller
                  control={control}
                  name="dashboard_visibility"
                  render={({ field }) => (
                    <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-3 sm:grid-cols-2">
                      {VISIBILITY.map(({ value, label, help, icon: Icon }) => (
                        <FieldLabel
                          key={value}
                          htmlFor={`vis-${value}`}
                          className={cn(
                            "cursor-pointer rounded-xl border border-line p-3.5 transition-colors",
                            field.value === value && "border-primary bg-line/40",
                          )}
                        >
                          <Field orientation="horizontal">
                            <RadioGroupItem value={value} id={`vis-${value}`} />
                            <Icon className="size-4 text-highlight" aria-hidden />
                            <span className="flex-1 text-sm font-medium">{label}</span>
                            <Tooltip>
                              <TooltipTrigger
                                render={<button type="button" className="text-muted hover:text-text" aria-label={help} />}
                              >
                                <HelpCircle aria-hidden className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-60">
                                {help}
                              </TooltipContent>
                            </Tooltip>
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {NOTIFICATIONS.map(({ name, title, description, icon: Icon }) => (
                  <FieldLabel key={name} htmlFor={name} className="rounded-xl border border-line p-3.5">
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle className="flex items-start gap-2">
                          <span className="flex shrink-0 items-center justify-center rounded-md border border-line bg-bg p-1.5">
                            <Icon aria-hidden className="size-4 text-highlight" />
                          </span>
                          <span className="flex flex-col items-start gap-0.5">
                            <span className="text-sm font-semibold">{title}</span>
                            <span className="text-xs font-normal text-muted">{description}</span>
                          </span>
                        </FieldTitle>
                      </FieldContent>
                      <Controller
                        control={control}
                        name={name}
                        render={({ field }) => <Switch id={name} checked={field.value} onCheckedChange={field.onChange} size="sm" />}
                      />
                    </Field>
                  </FieldLabel>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* ---------- Right column ---------- */}
          <div className="flex min-w-0 flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>What teammates see next to your name. Set leave so work goes to your backup.</CardDescription>
              </CardHeader>
              <CardContent>
                <StatusCard meId={user.id} members={members.data ?? []} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Team</CardTitle>
                <CardDescription>Everyone in {user.workspace.name} and what they&apos;re responsible for.</CardDescription>
              </CardHeader>
              <CardContent>
                {members.data ? (
                  <TeamTree workspaceName={user.workspace.name} members={members.data} />
                ) : members.isError ? (
                  <p className="text-sm text-accent">{members.error.message}</p>
                ) : (
                  <div className="h-24 animate-pulse rounded-lg bg-line/40" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                {activity.data ? (
                  <ActivityTimeline items={activity.data.slice(0, 8)} />
                ) : (
                  <div className="h-24 animate-pulse rounded-lg bg-line/40" />
                )}
              </CardContent>
            </Card>

            <Card id="account" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Account</CardTitle>
                <CardDescription>Password, your data, and leaving or deleting.</CardDescription>
              </CardHeader>
              <CardContent>
                <AccountPanel user={user} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How are we doing?</CardTitle>
                <CardDescription>Your rating goes straight to the people building Vyuham.</CardDescription>
              </CardHeader>
              <CardContent>
                <FeedbackCard />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ---------- Save bar ---------- */}
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-line bg-surface/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="mr-auto text-sm text-muted" role="status">
            {save.isError ? (
              <span className="text-accent">{save.error.message}</span>
            ) : save.isSuccess && !formState.isDirty ? (
              <span className="inline-flex items-center gap-1.5 text-highlight">
                <Check className="size-4" aria-hidden /> Saved
              </span>
            ) : formState.isDirty ? (
              "You have unsaved changes"
            ) : (
              "All changes saved"
            )}
          </p>
          <Button type="button" variant="ghost" disabled={!formState.isDirty || save.isPending} onClick={() => reset()}>
            Discard
          </Button>
          <Button type="button" onClick={onSubmit} disabled={save.isPending || (!formState.isDirty && !needsRole)}>
            {save.isPending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </PageContainer>
    </TooltipProvider>
  );
}

function ProfileSkeleton() {
  return (
    <PageContainer className="gap-6" aria-busy>
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </PageContainer>
  );
}
