import { ArrowRight, ArrowUpRight, Check, MousePointerClick } from "lucide-react";
import Link from "next/link";

import { Announcement } from "@/components/marketing/announcement";
import { SiteNav } from "@/components/marketing/site-nav";
import { ParticlesBackground } from "@/components/marketing/particles-background";
import { Typewriter } from "@/components/marketing/typewriter";
import { Mark } from "@/components/ui/mark";


// The headline is "Ask your data …": the first half answers, the rest builds.
const PHRASES = ["about revenue.", "for top customers.", "then build its pipeline.", "then keep it fresh."];

const glass =
  "rounded-[18px] border border-white/10 bg-white/[0.045] backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]";

export function Hero() {
  return (
    <section id="top" className="relative px-2 pt-2 sm:px-3 sm:pt-3">
      {/* Thin orbit arcs behind the panel */}
      <svg
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[1400px] -translate-x-1/2"
        viewBox="0 0 1400 520"
        fill="none"
        aria-hidden
      >
        <circle cx="700" cy="760" r="620" stroke="#f2545b" strokeOpacity="0.16" />
        <circle cx="700" cy="760" r="700" stroke="#ffb37a" strokeOpacity="0.09" />
      </svg>

      <div className="theme-dark dark hero-panel relative isolate mx-auto min-h-[min(100svh,980px)] max-w-[1440px] overflow-hidden rounded-[28px] border border-white/[0.06] sm:rounded-[36px]">
        {/* Light rays from the top left */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
          <div className="ray left-[22%] w-[70px] [animation-delay:0s]" />
          <div className="ray left-[29%] w-[120px] [animation-delay:-2s]" />
          <div className="ray left-[37%] w-[46px] [animation-delay:-4s]" />
          <div className="ray left-[42%] w-[90px] [animation-delay:-1s]" />
          <div className="ray left-[50%] w-[40px] opacity-70 [animation-delay:-3s]" />
        </div>

        {/* Particles (Magic UI) */}
        <ParticlesBackground className="absolute inset-0 -z-10" quantity={55} color="#ffffff" size={0.45} staticity={30} ease={60} />

        {/* Navigation */}
        <SiteNav variant="overlay" />

        {/* Headline: left-aligned, heavy/light contrast, the question in a lighter weight */}
        <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-start px-[clamp(20px,5vw,64px)] pt-[clamp(48px,8vw,104px)]">
          {/* Soft scrim so the copy stays legible where the arch passes behind it */}
          <div className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,rgba(7,5,4,0.6),transparent)]" aria-hidden />
          <Announcement href="/#platform">New: pipelines, dynamic tables and governance</Announcement>
          <h1
            aria-label="Ask your data, and build the pipelines that feed it. Analytics and data engineering in one workspace."
            className="mt-7 max-w-[14ch] text-[clamp(40px,6.4vw,92px)] font-semibold leading-[1] tracking-[-0.045em]"
          >
            <span aria-hidden>
              <span className="text-lit">Ask your data</span>
              <br />
              <span className="font-extralight tracking-[-0.02em] text-highlight">
                <Typewriter phrases={PHRASES} />
              </span>
            </span>
          </h1>
          <p className="mt-7 max-w-[50ch] text-[clamp(16px,1.5vw,19px)] font-light leading-relaxed text-white/80">
            Vyuham is one workspace for the people who need the numbers and the people who prepare them. Ask in plain
            English and get <Mark sweepOnLoad>a one-line answer with the right chart</Mark>. Build the pipelines, SQL
            and self-refreshing tables behind it on the same data.{" "}
            <span className="text-white">Every query follows the same access rules.</span>
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold">
              Start free
              <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
            </Link>
            <Link href="/try" className="btn-ghost inline-flex min-h-12 items-center gap-2.5 rounded-full py-1 pl-2 pr-6 text-[15px] font-medium">
              <span className="flex size-8 items-center justify-center rounded-full bg-white/10">
                <MousePointerClick className="size-3.5" strokeWidth={2} aria-hidden />
              </span>
              Try it with sample data
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-white/55">No sign-up needed for the sample. Your own data takes a free account.</p>
        </div>

        {/* The arch */}
        <div className="arch-wrap pointer-events-none absolute bottom-0 left-1/2 -z-10 w-[min(1180px,135%)] -translate-x-1/2 sm:w-[min(1180px,96%)]" aria-hidden>
          <div className="arch-glow" />
          <div className="arch-ring arch-ring--outer" />
          <div className="arch-ring arch-ring--main" />
          <div className="arch-ring arch-ring--inner" />
        </div>
        <div className="hero-fade pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[28%]" aria-hidden />

        {/* Floating glass cards */}
        <div className="pointer-events-none absolute bottom-0 left-[52%] right-0 z-10 hidden h-[56%] lg:block" aria-hidden>
          <div className={`${glass} float absolute left-[4%] top-[4%] flex w-[250px] items-center gap-5 p-4`}>
            <div>
              <p className="flex items-center gap-1.5 text-[13px] text-highlight">
                +27% <ArrowUpRight className="size-3.5" strokeWidth={2.4} />
              </p>
              <p className="text-[34px] font-light tracking-tight text-white/90">$48.2k</p>
            </div>
            <div className="flex-1 border-l border-white/10 pl-4">
              <p className="text-[15px] text-white/85">Revenue</p>
              <p className="mt-1.5 border-b border-white/15 pb-1 text-[13px] text-white/55">October</p>
            </div>
          </div>

          <div className={`${glass} float absolute left-[22%] top-[50%] w-[190px] p-4 [animation-delay:-3s]`}>
            <div className="flex items-start justify-between">
              <p className="text-[12px] text-white/55">pipeline run</p>
              <span className="flex size-6 items-center justify-center rounded-full bg-white/20">
                <Check className="size-3.5 text-white" strokeWidth={2.4} />
              </span>
            </div>
            <p className="mt-3 text-[15px] leading-tight text-white/75">Daily revenue: 4 steps succeeded</p>
            <p className="mt-2 text-right text-[11px] text-white/45">06:00 · 4.2 s</p>
          </div>

          <div className={`${glass} float absolute right-[6%] top-[20%] w-[230px] p-4 [animation-delay:-1.5s]`}>
            <div className="flex justify-between text-[12px] text-white/55">
              <span>orders / week</span>
              <span>3,184 total</span>
            </div>
            <svg viewBox="0 0 200 56" className="mt-2 h-14 w-full">
              {[22, 30, 18, 34, 26, 40, 31, 46, 38, 52].map((h, i) => (
                <rect key={i} x={i * 20 + 4} y={56 - h} width="10" height={h} rx="3" fill={i === 9 ? "#f2545b" : "#f07a2b"} fillOpacity={i === 9 ? 0.9 : 0.55} />
              ))}
              <polyline
                points="9,40 29,30 49,42 69,26 89,34 109,20 129,28 149,14 169,22 189,8"
                fill="none"
                stroke="#ffb37a"
                strokeWidth="1.5"
                strokeOpacity="0.7"
              />
            </svg>
          </div>

          <div className={`${glass} float absolute right-[12%] top-[62%] w-[220px] p-4 opacity-40 blur-[1px] [animation-delay:-4s]`}>
            <p className="text-[15px] text-white/80">customer_revenue</p>
            <p className="mt-1 border-b border-white/15 pb-1 text-[13px] text-white/55">refreshed 2 min ago</p>
          </div>

        </div>
      </div>
    </section>
  );
}
