import { ArrowRight, ArrowUpRight, Play } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { ParticlesBackground } from "@/components/marketing/particles-background";
import { Typewriter } from "@/components/marketing/typewriter";
import { Mark } from "@/components/ui/mark";

const NAV = [
  { href: "#top", label: "Home", active: true },
  { href: "#problem", label: "The problem" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const PHRASES = ["anything.", "about revenue.", "who stopped buying.", "where cash goes."];

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
        <circle cx="700" cy="760" r="620" stroke="#cb72d0" strokeOpacity="0.16" />
        <circle cx="700" cy="760" r="700" stroke="#cea3f5" strokeOpacity="0.09" />
      </svg>

      <div className="hero-panel relative isolate mx-auto min-h-[min(100svh,980px)] max-w-[1440px] overflow-hidden rounded-[28px] border border-white/[0.06] sm:rounded-[36px]">
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
        <header className="relative z-20 flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6">
          <Logo />
          <nav
            aria-label="Sections"
            className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] p-1 backdrop-blur-md md:flex"
          >
            {NAV.map((l) => (
              <a
                key={l.href}
                href={l.href}
                aria-current={l.active ? "page" : undefined}
                className={`flex min-h-9 items-center rounded-full px-4 text-[14px] transition-colors ${
                  l.active ? "bg-white/15 text-white" : "text-white/75 hover:text-white"
                }`}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <Link href="/login" className="hidden min-h-11 items-center px-3 text-[14px] text-white/75 hover:text-white sm:flex">
              Log in
            </Link>
            <Link
              href="/signup"
              className="btn-ghost flex min-h-10 items-center rounded-full px-5 text-[14px] font-semibold"
            >
              Join beta
            </Link>
          </div>
        </header>

        {/* Headline: left-aligned, heavy/light contrast, the question in a lighter weight */}
        <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-start px-[clamp(20px,5vw,64px)] pt-[clamp(48px,8vw,104px)]">
          {/* Soft scrim so the copy stays legible where the arch passes behind it */}
          <div className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10 bg-[radial-gradient(closest-side,rgba(5,4,10,0.6),transparent)]" aria-hidden />
          <p className="eyebrow">
            Free during the beta <b>· No card</b>
          </p>
          <h1
            aria-label="Ask your spreadsheet anything: an AI dashboard for small businesses."
            className="mt-7 max-w-[13ch] text-[clamp(40px,6.4vw,92px)] font-semibold leading-[1] tracking-[-0.045em]"
          >
            <span aria-hidden>
              <span className="text-lit">Ask your spreadsheet</span>
              <br />
              <span className="font-extralight tracking-[-0.02em] text-highlight">
                <Typewriter phrases={PHRASES} />
              </span>
            </span>
          </h1>
          <p className="mt-7 max-w-[46ch] text-[clamp(16px,1.5vw,19px)] font-light leading-relaxed text-white/80">
            The AI dashboard for small businesses. Upload Excel, CSV or Google Sheets, ask about your numbers in plain
            English and get <Mark sweepOnLoad>the answer plus a chart</Mark> in seconds.{" "}
            <span className="text-white">No analyst. No formulas. No data model.</span>
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="btn-primary inline-flex min-h-12 items-center gap-2 rounded-full px-7 text-[15px] font-semibold">
              Upload your first spreadsheet
              <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
            </Link>
            <a href="#product" className="btn-ghost inline-flex min-h-12 items-center gap-2.5 rounded-full py-1 pl-2 pr-6 text-[15px] font-medium">
              <span className="flex size-8 items-center justify-center rounded-full bg-white/10">
                <Play className="size-3 fill-current" strokeWidth={0} aria-hidden />
              </span>
              See it answer
            </a>
          </div>
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
                +18% <ArrowUpRight className="size-3.5" strokeWidth={2.4} />
              </p>
              <p className="text-[34px] font-light tracking-tight text-white/90">$48.2k</p>
            </div>
            <div className="flex-1 border-l border-white/10 pl-4">
              <p className="text-[15px] text-white/85">Revenue</p>
              <p className="mt-1.5 border-b border-white/15 pb-1 text-[13px] text-white/55">October</p>
            </div>
          </div>

          <div className={`${glass} float absolute left-[22%] top-[50%] w-[170px] p-4 [animation-delay:-3s]`}>
            <div className="flex items-start justify-between">
              <p className="text-[12px] text-white/55">insight</p>
              <span className="flex size-6 items-center justify-center rounded-full bg-white/20">
                <ArrowUpRight className="size-3.5 text-white" strokeWidth={2.4} />
              </span>
            </div>
            <p className="mt-3 text-[15px] leading-tight text-white/75">Ad spend 30% over average</p>
            <p className="mt-2 text-right text-[11px] text-white/45">Oct 2026</p>
          </div>

          <div className={`${glass} float absolute right-[6%] top-[20%] w-[230px] p-4 [animation-delay:-1.5s]`}>
            <div className="flex justify-between text-[12px] text-white/55">
              <span>orders / week</span>
              <span>3,184 total</span>
            </div>
            <svg viewBox="0 0 200 56" className="mt-2 h-14 w-full">
              {[22, 30, 18, 34, 26, 40, 31, 46, 38, 52].map((h, i) => (
                <rect key={i} x={i * 20 + 4} y={56 - h} width="10" height={h} rx="3" fill={i === 9 ? "#cb72d0" : "#705cbb"} fillOpacity={i === 9 ? 0.9 : 0.55} />
              ))}
              <polyline
                points="9,40 29,30 49,42 69,26 89,34 109,20 129,28 149,14 169,22 189,8"
                fill="none"
                stroke="#cea3f5"
                strokeWidth="1.5"
                strokeOpacity="0.7"
              />
            </svg>
          </div>

          <div className={`${glass} float absolute right-[12%] top-[62%] w-[220px] p-4 opacity-40 blur-[1px] [animation-delay:-4s]`}>
            <p className="text-[15px] text-white/80">Halden &amp; Co</p>
            <p className="mt-1 border-b border-white/15 pb-1 text-[13px] text-white/55">22% of revenue</p>
          </div>

        </div>
      </div>
    </section>
  );
}
