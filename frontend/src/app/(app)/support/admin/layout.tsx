import { notFound } from "next/navigation";

import { getCurrentUser } from "@/lib/api/server";

/** Staff-only: everyone else gets a 404, the same answer the API gives. */
export default async function SupportAdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user?.is_staff) notFound();
  return children;
}
