import { BookOpen, LifeBuoy, MessageCircle, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageShell, pageLead, pageTitle } from "@/components/marketing/page-shell";

export const metadata: Metadata = {
  title: "Support",
  description: "Get help with Vyuham: answers to common questions, the in-app assistant and chat with our team.",
  alternates: { canonical: "/help" },
};

const OPTIONS = [
  {
    icon: BookOpen,
    title: "Common questions",
    text: "How uploads work, which files are supported, pricing and how your data is handled.",
    href: "/#faq",
    cta: "Read the FAQ",
  },
  {
    icon: MessageCircle,
    title: "Chat with our team",
    text: "Already using Vyuham? Open Help & Support in the app to chat with us, see your conversations or report a problem.",
    href: "/support",
    cta: "Open Help & Support",
  },
  {
    icon: LifeBuoy,
    title: "AI support assistant",
    text: "In the app, “Ask AI support” explains errors and suggests what to try, and tells you which steps are fixes our team has tested.",
    href: "/login",
    cta: "Log in",
  },
  {
    icon: ShieldCheck,
    title: "Privacy and your data",
    text: "What we collect, how it's used, and how to export or delete your data.",
    href: "/privacy",
    cta: "Privacy policy",
  },
];

export default function HelpPage() {
  return (
    <PageShell>
      <p className="eyebrow">Support</p>
      <h1 className={`${pageTitle} mt-6`}>How can we help?</h1>
      <p className={pageLead}>Find an answer, ask the in-app assistant, or talk to a person.</p>

      <ul className="mt-14 grid gap-4 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <li key={o.title} className="flex flex-col gap-3 rounded-[20px] border border-white/10 bg-white/[0.03] p-6">
            <o.icon className="size-5 text-highlight" strokeWidth={1.8} aria-hidden />
            <h2 className="text-[18px] font-semibold text-white">{o.title}</h2>
            <p className="flex-1 text-[15px] font-light leading-relaxed text-muted">{o.text}</p>
            <Link href={o.href} className="w-fit text-[14px] font-medium text-highlight hover:underline">{o.cta} →</Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
