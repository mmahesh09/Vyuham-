import { redirect } from "next/navigation";

import { Logo } from "@/components/layout/logo";
import { AuthVisual } from "@/features/auth/auth-visual";
import { getCurrentUser } from "@/lib/api/server";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/home");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col px-4 py-6 sm:px-8">
        <header>
          <Logo />
        </header>
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px]">{children}</div>
        </div>
      </section>
      <AuthVisual className="hidden lg:flex" />
    </main>
  );
}
