"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthField, FormError, SubmitButton } from "@/features/auth/fields";
import { api, ApiError } from "@/lib/api/client";

/** Creates the organization and its first workspace, then finishes setup. The key makes a double submit update, not duplicate. */
export function OrganizationForm() {
  const router = useRouter();
  const [creationKey] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [company, setCompany] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company.trim()) return setError("Enter your company or organization name.");
    setPending(true);
    setError(undefined);
    try {
      await api("/onboarding/organization", {
        method: "POST",
        body: JSON.stringify({
          creation_key: creationKey,
          company_name: company.trim(),
          workspace_name: workspace.trim() || null,
        }),
      });
      // The invite and personalize steps have no screens yet; mark setup done so the flag stays truthful.
      await api("/onboarding/complete", { method: "POST" });
      router.replace("/home");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <AuthField
        id="company"
        label="Company or organization"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        maxLength={120}
        autoComplete="organization"
        autoFocus
        required
      />
      <AuthField
        id="workspace"
        label="First workspace name"
        aside={<span className="text-xs text-faint">Optional</span>}
        placeholder={company.trim() ? `${company.trim()} workspace` : "e.g. Finance"}
        value={workspace}
        onChange={(e) => setWorkspace(e.target.value)}
        maxLength={120}
      />
      <FormError message={error} />
      <SubmitButton ready={!!company.trim()} pending={pending}>
        Create organization
      </SubmitButton>
    </form>
  );
}
