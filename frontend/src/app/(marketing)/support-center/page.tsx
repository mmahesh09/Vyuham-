import {
  Activity,
  ArrowRight,
  BookOpen,
  Bug,
  Check,
  CreditCard,
  FileSpreadsheet,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareText,
  MessagesSquare,
  Rocket,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Announcement } from "@/components/marketing/announcement";
import { Reveal } from "@/components/marketing/reveal";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteNav } from "@/components/marketing/site-nav";
import { LifecycleLog, ReplyMock, RequestListMock, TicketFrame } from "@/components/marketing/support/mocks";
import { body, card, container, delay, h2, quiet, sectionY } from "@/components/marketing/tokens";
import { HelpSearch } from "@/features/help/help-search";
import { formatDate, getAllPosts } from "@/lib/blog";
import { publicGet, type ComponentState, type HelpSummary, type StatusSummary } from "@/lib/public-api";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Support center",
  description:
    "Get help with Vyuham: search the help center, browse topics, check live system status or send a request to a person on the team.",
  alternates: { canonical: "/support-center" },
};

/** Topic cards. `keys` are matched against article tags (lowercase, partial) to count and link articles. */
const TOPICS: { title: string; text: string; icon: LucideIcon; keys: string[] }[] = [
  { title: "Getting started", text: "Your first upload, your first question and the starter dashboard.", icon: Rocket, keys: ["start", "general", "onboard"] },
  { title: "Uploading data", text: "Excel, CSV and Google Sheets: formats, sizes, dates and messy columns.", icon: FileSpreadsheet, keys: ["upload", "data", "csv", "excel", "sheet", "import"] },
  { title: "Asking questions", text: "How to phrase a question, follow-ups and why an answer looks off.", icon: MessageSquareText, keys: ["question", "ask", "ai", "answer"] },
  { title: "Dashboards & sharing", text: "Pin answers, filters, share links and turning a link off.", icon: LayoutDashboard, keys: ["dashboard", "share", "chart", "report"] },
  { title: "Account & billing", text: "Sign-in, email, the beta and what happens after it.", icon: CreditCard, keys: ["billing", "account", "login", "password"] },
  { title: "Teams & bugs", text: "Inviting teammates, roles, and what to do when something breaks.", icon: Users, keys: ["team", "invite", "bug", "error"] },
];

const STATE_LABEL: Record<ComponentState, string> = {
  operational: "All systems go",
  maintenance: "Maintenance",
  degraded: "Degraded",
  major_outage: "Outage",
};
const STATE_DOT: Record<ComponentState, string> = {
  operational: "bg-success",
  maintenance: "bg-info",
  degraded: "bg-warning",
  major_outage: "bg-destructive",
};

function topicMatches(article: HelpSummary, keys: string[]) {
  return article.tags.some((t) => keys.some((k) => t.toLowerCase().includes(k)));
}

function SectionHead({ title, quietPart, text, className }: { title: string; quietPart: string; text: string; className?: string }) {
  return (
    <div data-animate className={cn("mb-12 grid gap-6 lg:grid-cols-[6fr_5fr] lg:items-end", className)}>
      <h2 className={h2}>
        {title} <span className={quiet}>{quietPart}</span>
      </h2>
      <p className={`${body} max-w-[46ch]`}>{text}</p>
    </div>
  );
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-11 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-highlight">
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

export default async function SupportCenterPage() {
  const [articles, status, posts] = await Promise.all([
    publicGet<HelpSummary[]>("/kb"),
    publicGet<StatusSummary>("/status", 60),
    getAllPosts(),
  ]);
  const kb = articles ?? [];
  const latestPosts = posts.filter((p) => !p.draft).slice(0, 3);
  const popular = kb.slice(0, 3);
  const overall = status?.overall;
  const statusLabel = overall ? STATE_LABEL[overall] : "Unavailable";
  const statusDays = status?.components[0]?.days ?? {};
  const bars = Object.keys(statusDays).sort().slice(-30);

  return (
    <div className="theme-dark dark flex min-h-screen flex-col overflow-x-clip bg-bg">
      <Reveal />
      <SiteNav variant="bar" />

      <main className="flex-1">
        {/* Hero: centered, search first, then the product frame */}
        <section className="relative isolate pb-[clamp(64px,10vw,120px)] pt-[clamp(48px,8vw,96px)]">
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
            <div className="ray left-[30%] w-[80px]" />
            <div className="ray left-[44%] w-[50px] [animation-delay:-3s]" />
            <div className="ray left-[58%] w-[100px] [animation-delay:-5s]" />
          </div>
          <div className="glow glow--violet left-1/2 top-[30%] h-[420px] w-[min(760px,95vw)] -translate-x-1/2" />

          <div className={`${container} flex flex-col items-center text-center`}>
            <Announcement>Support center · Real people</Announcement>
            <h1 className="mt-6 max-w-[18ch] text-balance text-[clamp(36px,6vw,72px)] font-semibold leading-[1.02] tracking-[-0.04em] text-white">
              How can we help <span className="font-extralight text-highlight">you today?</span>
            </h1>
            <p className={`${body} mt-5 max-w-[52ch]`}>
              Search the answers our customers needed before you, or write to us. Every request is read by a person on
              the team.
            </p>
            <div className="mt-8 w-full max-w-[620px] text-left">
              <HelpSearch />
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link href="/support/new" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold">
                Contact support <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
              </Link>
              <Link href="/help" className="btn-ghost inline-flex min-h-12 items-center gap-2 rounded-full px-6 text-[15px] font-medium">
                <BookOpen className="size-4" aria-hidden /> Browse help center
              </Link>
            </div>
          </div>

          <div data-animate style={delay(120)} className="mx-auto mt-14 w-full max-w-[880px] px-[clamp(16px,5vw,48px)]">
            <TicketFrame articleCount={articles ? kb.length : null} statusLabel={statusLabel} />
          </div>
        </section>

        {/* Topics: the 3×2 card grid */}
        <section className={`band ${sectionY}`}>
          <div className={container}>
            <SectionHead
              title="Find answers"
              quietPart="by topic."
              text="Six areas cover almost every question we get. Each one opens the matching articles in the help center."
            />
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {TOPICS.map((t, i) => {
                const matches = kb.filter((a) => topicMatches(a, t.keys));
                const firstTag = matches[0]?.tags[0];
                return (
                  <li key={t.title} data-animate style={delay((i % 3) * 80)}>
                    <Link
                      href={firstTag ? `/help#${encodeURIComponent(firstTag)}` : "/help"}
                      className={`${card} group flex h-full flex-col gap-4 p-6 transition-colors hover:border-primary/40 hover:bg-primary/[0.04]`}
                    >
                      <IconTile icon={t.icon} />
                      <div className="flex flex-col gap-2">
                        <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-white">{t.title}</h3>
                        <p className="text-[15px] font-light leading-relaxed text-white/65">{t.text}</p>
                      </div>
                      <span className="mt-auto flex items-center gap-1.5 pt-2 text-[13.5px] text-highlight">
                        {matches.length > 0 ? `${matches.length} article${matches.length === 1 ? "" : "s"}` : "Browse articles"}
                        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Ways to get help: bento */}
        <section className={sectionY}>
          <div className={container}>
            <h2 data-animate className={`${h2} mx-auto mb-12 max-w-[20ch] text-center`}>
              Every way to get unstuck, <span className={quiet}>in one place.</span>
            </h2>

            <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
              {/* Talk to a person: full width */}
              <div data-animate className={`${card} relative isolate grid items-center gap-8 overflow-hidden p-6 sm:p-10 lg:col-span-2 lg:grid-cols-2`}>
                <div className="glow glow--violet -right-[10%] -top-[30%] h-[320px] w-[420px]" />
                <div className="flex flex-col items-start gap-4">
                  <IconTile icon={LifeBuoy} />
                  <h3 className="text-[clamp(22px,2.4vw,28px)] font-semibold leading-tight tracking-[-0.025em] text-white">
                    Talk to a person, not a bot
                  </h3>
                  <p className="max-w-[44ch] text-[15.5px] font-light leading-relaxed text-white/65">
                    Tell us what you were trying to do and what happened. We reply within one working day, by email and
                    in your workspace.
                  </p>
                  <Link href="/support/new" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-highlight hover:underline">
                    Write to us <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </div>
                <ReplyMock />
              </div>

              {/* Live status */}
              <div data-animate className={`${card} flex flex-col gap-5 p-6 sm:p-8`}>
                <IconTile icon={Activity} />
                <div>
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-white">Live system status</h3>
                  <p className="mt-2 text-[15px] font-light leading-relaxed text-white/65">
                    Check here first when something feels slow. It updates every minute.
                  </p>
                </div>
                <div className="mt-auto rounded-xl border border-white/[0.07] bg-black/30 p-4">
                  <p className="flex items-center gap-2 text-[15px] font-medium text-white">
                    <span className={cn("size-2.5 rounded-full", overall ? STATE_DOT[overall] : "bg-white/30")} aria-hidden />
                    {status ? statusLabel : "Status is unavailable right now"}
                  </p>
                  {bars.length > 0 && (
                    <div className="mt-3 flex h-8 items-end gap-[3px]" role="img" aria-label="Uptime for the last 30 days">
                      {bars.map((d) => {
                        const pct = statusDays[d];
                        return (
                          <span
                            key={d}
                            className={cn("h-full flex-1 rounded-[2px]", pct >= 99.5 ? "bg-success/80" : pct >= 95 ? "bg-warning/80" : "bg-destructive/80")}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
                <Link href="/status" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-highlight hover:underline">
                  Full status page <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>

              {/* Your requests */}
              <div data-animate style={delay(80)} className={`${card} flex min-w-0 flex-col gap-5 p-6 sm:p-8`}>
                <div>
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-white">Follow your requests</h3>
                  <p className="mt-2 max-w-[48ch] text-[15px] font-light leading-relaxed text-white/65">
                    Every request from your workspace, its status and the full conversation. Log in to see yours.
                  </p>
                </div>
                <RequestListMock />
                <Link href="/support" className="mt-auto inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-highlight hover:underline">
                  Open my requests <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            </div>

            <div data-animate className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link href="/support/new" className="btn-primary inline-flex min-h-11 items-center rounded-full px-6 text-[14.5px] font-semibold">
                Contact support
              </Link>
              <Link href="/help" className="btn-ghost inline-flex min-h-11 items-center rounded-full px-6 text-[14.5px] font-medium">
                Browse all articles
              </Link>
            </div>
          </div>
        </section>

        {/* How a request is handled */}
        <section className={`band ${sectionY}`}>
          <div className={container}>
            <div data-animate className={`${card} relative isolate overflow-hidden p-6 sm:p-10`}>
              <div className="glow glow--lilac -left-[10%] top-[10%] h-[300px] w-[420px]" />
              <div className="grid items-center gap-10 lg:grid-cols-2">
                <div className="flex flex-col gap-5">
                  <h2 className="text-balance text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.06] tracking-[-0.03em] text-white">
                    What happens after <span className={quiet}>you write to us.</span>
                  </h2>
                  <p className={`${body} max-w-[44ch]`}>
                    No ticket queue you never hear back from. You can see where your request is at every step.
                  </p>
                </div>
                <LifecycleLog />
              </div>

              <div className="mt-10 grid gap-4 md:grid-cols-2">
                <div className="rounded-[14px] border border-white/[0.08] bg-black/30 p-6">
                  <h3 className="text-[18px] font-semibold text-white">Get a faster answer</h3>
                  <ul className="mt-4 flex flex-col gap-3">
                    {[
                      "What you were trying to do",
                      "What you expected, and what happened instead",
                      "The dashboard or file it happened in",
                    ].map((x) => (
                      <li key={x} className="grid grid-cols-[18px_1fr] gap-2.5 text-[15px] font-light text-white/75">
                        <Check className="mt-1 size-4 text-highlight" strokeWidth={2.4} aria-hidden />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-[14px] border border-white/[0.08] bg-black/30 p-6">
                  <div className="flex items-center gap-3">
                    <Bug className="size-5 text-highlight" aria-hidden />
                    <h3 className="text-[18px] font-semibold text-white">Errors report themselves</h3>
                  </div>
                  <p className="mt-4 text-[15px] font-light leading-relaxed text-white/70">
                    When something breaks in the app, we get the technical details automatically. The error screen gives
                    you a reference you can mention in your request, so you don&apos;t have to describe it twice.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* A few articles to start with (no invented testimonials) */}
        {popular.length > 0 && (
          <section className={sectionY}>
            <div className={container}>
              <div data-animate className="mb-12 flex flex-col items-center gap-4 text-center">
                <h2 className={h2}>
                  Start <span className={quiet}>with these.</span>
                </h2>
                <p className={`${body} max-w-[52ch]`}>Each one started as a real question from a customer.</p>
              </div>
              <ul className="grid gap-4 md:grid-cols-3">
                {popular.map((a, i) => (
                  <li key={a.id} data-animate style={delay(i * 80)}>
                    <Link
                      href={`/help/${a.slug}`}
                      className={`${card} group flex h-full flex-col gap-3 p-6 transition-colors hover:border-primary/40`}
                    >
                      <span className="w-fit rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] capitalize text-highlight">
                        {a.tags[0] ?? "general"}
                      </span>
                      <h3 className="text-[18px] font-semibold leading-snug tracking-[-0.015em] text-white group-hover:text-highlight">
                        {a.title}
                      </h3>
                      {a.summary && <p className="text-[14.5px] font-light leading-relaxed text-white/65">{a.summary}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Still stuck: the glow card */}
        <section className="px-[clamp(16px,5vw,48px)] pb-[clamp(72px,10vw,120px)]">
          <div className="hero-panel relative isolate mx-auto flex max-w-[1000px] flex-col items-center overflow-hidden rounded-[28px] border border-white/[0.06] px-6 pb-[clamp(96px,14vw,160px)] pt-[clamp(56px,8vw,88px)] text-center">
            <div className="arch-wrap pointer-events-none absolute bottom-[-45%] left-1/2 -z-10 w-[min(820px,150%)] -translate-x-1/2" aria-hidden>
              <div className="arch-glow" />
              <div className="arch-ring arch-ring--outer" />
              <div className="arch-ring arch-ring--main" />
              <div className="arch-ring arch-ring--inner" />
            </div>
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-highlight">
              <MessagesSquare className="size-7" aria-hidden />
            </span>
            <h2 data-animate className="mt-6 max-w-[16ch] text-[clamp(32px,5vw,56px)] font-semibold leading-[1.04] tracking-[-0.035em] text-white">
              Still stuck? <span className="font-extralight text-highlight">Talk to us.</span>
            </h2>
            <p className="mt-4 max-w-[46ch] text-[16px] font-light leading-relaxed text-white/70">
              Send a request and a person on the team will get back to you within one working day.
            </p>
            <Link href="/support/new" className="btn-primary mt-8 inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold">
              Contact support <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
            </Link>
          </div>
        </section>

        {/* From the blog */}
        {latestPosts.length > 0 && (
          <section className={`band ${sectionY}`}>
            <div className={container}>
              <div data-animate className="mb-12 flex flex-wrap items-end justify-between gap-6">
                <h2 className={h2}>
                  From the blog. <span className={quiet}>Guides and stories.</span>
                </h2>
                <Link href="/blog" className="btn-primary inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-semibold">
                  All posts
                </Link>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {latestPosts.map((p, i) => (
                  <li key={p.slug} data-animate style={delay(i * 80)}>
                    <Link href={`/blog/${p.slug}`} className={`${card} group flex h-full flex-col gap-3 p-6 transition-colors hover:border-primary/40`}>
                      <div className="flex flex-wrap gap-1.5">
                        {p.tags.slice(0, 2).map((t) => (
                          <span key={t} className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[12px] text-white/60">
                            {t}
                          </span>
                        ))}
                      </div>
                      <h3 className="text-[18px] font-semibold leading-snug tracking-[-0.015em] text-white group-hover:text-highlight">
                        {p.title}
                      </h3>
                      <p className="line-clamp-3 text-[14.5px] font-light leading-relaxed text-white/65">{p.description}</p>
                      <p className="mt-auto flex items-center justify-between pt-3 text-[13px] text-white/45">
                        <span>{formatDate(p.date)}</span>
                        <span className="flex items-center gap-1 text-highlight">
                          Read more <ArrowRight className="size-3.5" aria-hidden />
                        </span>
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
