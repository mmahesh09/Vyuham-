import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { SupportAdminScreen } from "@/features/support-admin/admin-screen";
import { BACKEND_URL } from "@/lib/api/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Support admin", robots: { index: false, follow: false } };

/** Internal dashboard. The server decides access (backend/app/support_ai/access.py); non-staff get a 404. */
export default async function SupportAdminPage() {
  const res = await fetch(`${BACKEND_URL}/support/admin/me`, { headers: { cookie: (await cookies()).toString() }, cache: "no-store" });
  if (!res.ok) notFound();
  const me = (await res.json()) as { role: "admin" | "staff"; email: string };
  return <SupportAdminScreen role={me.role} email={me.email} />;
}
