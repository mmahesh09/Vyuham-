import { ArrowRight, Clock, Mail, MessageSquareText, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Announcement } from "@/components/marketing/announcement";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { StatusPill } from "@/components/marketing/support/system-status";
import { body, card, container, delay, quiet } from "@/components/marketing/tokens";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpSearch } from "@/features/help/help-search";
import { HELP_TOPICS, inTopic, topicOf } from "@/features/help/topics";
import { ContactSupport, RecentRequests } from "@/features/support/support-center-panels";
import { publicGet, type HelpSummary, type StatusSummary } from "@/lib/public-api";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Support center",
  description:
    "Get help with Vyuham: search the help center, browse topics, check live system status or send a request to the team.",
  alternates: { canonical: "/support-center" },
};

const sectionPad = "py-[clamp(48px,7vw,88px)]";
const h2 = "text-balance text-[clamp(24px,2.8vw,34px)] font-semibold leading-[1.12] tracking-[-0.025em] text-white";
const eyebrow = "font-mono text-[11.5px] uppercase tracking-[0.14em] text-faint";

const PROMISES = [
  { icon: UserRound, title: "A person reads every request", text: "No bots in the loop. Someone on the team looks at what you sent." },
  { icon: Mail, title: "Replies in the app and by email", text: "The whole conversation stays in one place, with an email when we answer." },
  { icon: MessageSquareText, title: "Details get you there faster", text: "What you tried, what you expected, and the dashboard or file it happened in." },
];

const LINKS = [
  ["Help center", "/help"],
  ["System status", "/status"],
  ["Privacy", "/privacy"],
  ["Terms", "/terms"],
] as const;

function ArticleRow({ a, i }: { a: HelpSummary; i: number }) {
  const category = topicOf(a)?.title ?? a.tags[0];
  return (
    <li data-animate style={delay(i * 50)}>
      <Link
        href={`/help/${a.slug}`}
        className="group flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-highlight"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-medium leading-snug text-white group-hover:text-highlight">{a.title}</span>
          <span className="flex flex-wrap items-center gap-x-2.5 text-[12.5px] text-white/45">
            {category && <span className="capitalize">{category}</span>}
            {a.read_minutes ? (
              <span className="flex items-center gap-1">
                <Clock className="size-3" aria-hidden /> {a.read_minutes} min read
              </span>
            ) : null}
          </span>
        </span>
        <ArrowRight className="mt-1 size-4 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-highlight" aria-hidden />
      </Link>
    </li>
  );
}

export default async function SupportCenterPage() {
  const [articles, popularRaw, status] = await Promise.all([
    publicGet<HelpSummary[]>("/kb"),
    publicGet<HelpSummary[]>("/kb/popular?limit=6"),
    publicGet<StatusSummary>("/status", 60),
  ]);
  const kb = articles ?? [];
  // "Popular" only when people have actually used articles; otherwise say what the list really is.
  const usage = popularRaw ?? [];
  const featured = usage.length > 0 ? usage : [...kb].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);

  return (
    <div className="theme-dark dark flex min-h-screen flex-col overflow-x-clip bg-bg">
      <Reveal />
      <SiteNav variant="bar" />

      <main id="main" className="flex-1">
        {/* 1. Hero: search first, live status, and your open requests if you're signed in */}
        <section aria-labelledby="hero-title" className="relative isolate pb-[clamp(40px,6vw,72px)] pt-[clamp(48px,8vw,96px)]">
          <div className="glow glow--violet left-1/2 top-[25%] h-[380px] w-[min(720px,95vw)] -translate-x-1/2" />
          <div className={`${container} flex flex-col items-center text-center`}>
            <Announcement>Support center</Announcement>
            <h1
              id="hero-title"
              className="mt-6 max-w-[18ch] text-balance text-[clamp(36px,5.4vw,64px)] font-semibold leading-[1.04] tracking-[-0.04em] text-white"
            >
              How can we <span className="font-extralight text-highlight">help?</span>
            </h1>
            <p className={`${body} mt-4 max-w-[50ch]`}>Search the guides, browse by topic, or tell us what&apos;s going on. We&apos;re happy to help.</p>
            <div className="mt-8 w-full max-w-[640px] text-left">
              <HelpSearch size="lg" suggestions={kb.length ? ["upload", "share link", "dates", "invite"] : []} />
            </div>
            <StatusPill status={status} className="mt-6" />
            <div className="mt-8 w-full max-w-[640px]">
              <RecentRequests />
            </div>
          </div>
        </section>

        {/* 2. Topics and articles, side by side */}
        <section aria-label="Browse help" className={`band ${sectionPad}`}>
          <div className={`${container} grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-12`}>
            <div id="topics" className="flex scroll-mt-20 flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className={eyebrow}>Browse by topic</p>
                <h2 className={h2}>
                  Find answers <span className={quiet}>by topic.</span>
                </h2>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {HELP_TOPICS.map((t, i) => {
                  const count = articles ? kb.filter((a) => inTopic(a, t)).length : null;
                  const Icon = t.icon;
                  return (
                    <li key={t.id} data-animate style={delay((i % 2) * 60)}>
                      <Link
                        href={`/help?topic=${t.id}`}
                        className={`${card} group flex h-full items-start gap-4 p-5 transition-colors hover:border-primary/40 hover:bg-primary/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight`}
                      >
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-highlight">
                          <Icon className="size-[18px]" aria-hidden />
                        </span>
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="text-[16px] font-semibold tracking-[-0.015em] text-white group-hover:text-highlight">{t.title}</span>
                          <span className="text-[13.5px] font-light leading-relaxed text-white/60">{t.text}</span>
                          {count ? (
                            <span className="pt-1 text-[12.5px] text-white/45">
                              {count} article{count === 1 ? "" : "s"}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div id="articles" className="flex scroll-mt-20 flex-col gap-6">
              <div className="flex flex-col gap-2">
                <p className={eyebrow}>{usage.length ? "Most helpful" : "Recently updated"}</p>
                <h2 className={h2}>
                  {usage.length ? "Popular" : "Fresh"} <span className={quiet}>articles.</span>
                </h2>
              </div>
              <div className={`${card} flex flex-1 flex-col p-2`}>
                {articles === null ? (
                  <p className="px-4 py-8 text-center text-[14.5px] text-white/65" role="status">
                    The help center isn&apos;t loading right now. Search above may still work, or{" "}
                    <a href="#contact" className="text-highlight hover:underline">
                      contact us
                    </a>
                    .
                  </p>
                ) : featured.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[14.5px] text-white/65">
                    The first articles are being written.{" "}
                    <a href="#contact" className="text-highlight hover:underline">
                      Ask the team directly
                    </a>{" "}
                    in the meantime.
                  </p>
                ) : (
                  <>
                    <ul className="flex flex-col divide-y divide-white/[0.06]">
                      {featured.map((a, i) => (
                        <ArticleRow key={a.id} a={a} i={i} />
                      ))}
                    </ul>
                    <Link
                      href="/help"
                      className="mt-auto flex min-h-11 items-center justify-center gap-1.5 rounded-xl border-t border-white/[0.06] pt-1 text-[14px] font-medium text-highlight hover:underline"
                    >
                      Browse all {kb.length} articles <ArrowRight className="size-4" aria-hidden />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* 3. Still need help: the guided request */}
        <section id="contact" aria-labelledby="contact-title" className={`scroll-mt-20 ${sectionPad}`}>
          <div className={`${container} grid gap-10 lg:grid-cols-[5fr_7fr] lg:gap-14`}>
            <div className="flex flex-col gap-8">
              <div data-animate className="flex flex-col gap-3">
                <p className={eyebrow}>Contact support</p>
                <h2 id="contact-title" className={h2}>
                  Still need help? <span className={quiet}>We&apos;re here.</span>
                </h2>
                <p className={`${body} max-w-[46ch] text-[16px]`}>
                  Tell us what&apos;s going on in three short steps. We&apos;ll point you to an article if one already answers it.
                </p>
              </div>
              <ul className="flex flex-col gap-5">
                {PROMISES.map(({ icon: Icon, title, text }, i) => (
                  <li key={title} data-animate style={delay(i * 70)} className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-highlight">
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15.5px] font-medium text-white">{title}</span>
                      <span className="text-[14px] font-light leading-relaxed text-white/60">{text}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div data-animate style={delay(80)} className="min-w-0">
              <Suspense fallback={<Skeleton className="h-[420px] rounded-[18px]" />}>
                <ContactSupport />
              </Suspense>
            </div>
          </div>
        </section>

        {/* 4. Links */}
        <nav aria-label="Support links" className="pb-6">
          <div className={`${container} flex flex-wrap items-center justify-center gap-x-6 gap-y-1 border-t border-white/[0.06] pt-6`}>
            {LINKS.map(([label, href]) => (
              <Link key={label} href={href} className="inline-flex min-h-11 items-center text-[14px] text-white/60 hover:text-highlight hover:underline">
                {label}
              </Link>
            ))}
          </div>
        </nav>
      </main>

      <SiteFooter />
    </div>
  );
}
