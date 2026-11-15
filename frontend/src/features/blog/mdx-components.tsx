import type { ComponentPropsWithoutRef, ReactNode } from "react";

import Image from "next/image";
import Link from "next/link";

/**
 * How Markdown in a blog post renders: the same type scale and colour tokens as the privacy page,
 * so posts look right in both themes without a typography plugin.
 */

const p = "text-[16.5px] leading-[1.8] text-muted";

function A({ href = "", children, ...rest }: ComponentPropsWithoutRef<"a">) {
  const cls = "font-medium text-highlight underline decoration-highlight/35 underline-offset-[3px] hover:decoration-highlight";
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

/** <Callout title="Tip">…</Callout>: a highlighted aside. */
function Callout({ title, children, tone = "tip" }: { title?: string; children: ReactNode; tone?: "tip" | "warning" }) {
  const edge = tone === "warning" ? "border-l-accent" : "border-l-highlight";
  return (
    <aside className={`my-2 rounded-[14px] border border-line border-l-4 ${edge} bg-surface px-5 py-4`}>
      {title && <p className="mb-1.5 text-sm font-semibold text-text">{title}</p>}
      <div className="flex flex-col gap-3 text-[15.5px] leading-[1.7] text-muted [&_p]:text-[15.5px]">{children}</div>
    </aside>
  );
}

/** <Figure src="/blog/slug/chart.png" alt="…" width={1600} height={900} caption="…" />: an optimised image. */
function Figure({ src, alt, width, height, caption }: { src: string; alt: string; width: number; height: number; caption?: string }) {
  return (
    <figure className="my-2 flex flex-col gap-2">
      <Image src={src} alt={alt} width={width} height={height} sizes="(min-width: 768px) 720px, 100vw" className="h-auto w-full rounded-[14px] border border-line" />
      {caption && <figcaption className="text-center text-[13px] text-faint">{caption}</figcaption>}
    </figure>
  );
}

export const mdxComponents = {
  h2: (props: ComponentPropsWithoutRef<"h2">) => (
    <h2 {...props} className="scroll-mt-24 pt-6 font-display text-[26px] font-semibold leading-tight tracking-[-0.01em] text-text" />
  ),
  h3: (props: ComponentPropsWithoutRef<"h3">) => (
    <h3 {...props} className="scroll-mt-24 pt-3 font-display text-[20px] font-semibold leading-snug text-text" />
  ),
  p: (props: ComponentPropsWithoutRef<"p">) => <p {...props} className={p} />,
  a: A,
  strong: (props: ComponentPropsWithoutRef<"strong">) => <strong {...props} className="font-semibold text-text" />,
  ul: (props: ComponentPropsWithoutRef<"ul">) => <ul {...props} className={`flex list-disc flex-col gap-2 pl-6 marker:text-faint ${p}`} />,
  ol: (props: ComponentPropsWithoutRef<"ol">) => <ol {...props} className={`flex list-decimal flex-col gap-2 pl-6 marker:text-faint ${p}`} />,
  li: (props: ComponentPropsWithoutRef<"li">) => <li {...props} className="pl-1" />,
  blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
    <blockquote {...props} className="border-l-2 border-line-strong pl-5 italic [&_p]:text-text/80" />
  ),
  hr: () => <hr className="my-4 border-line" />,
  code: (props: ComponentPropsWithoutRef<"code">) => (
    <code {...props} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.88em] text-text" />
  ),
  // Shiki has already coloured the code; this is the frame. Inline-code styling is undone inside it.
  pre: (props: ComponentPropsWithoutRef<"pre">) => (
    <pre
      {...props}
      className={`${props.className ?? ""} my-1 overflow-x-auto rounded-[14px] border border-line p-4 font-mono text-[13.5px] leading-[1.65] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]`}
    />
  ),
  table: (props: ComponentPropsWithoutRef<"table">) => (
    <div className="my-1 overflow-x-auto rounded-[14px] border border-line">
      <table {...props} className="w-full border-collapse text-left text-[14.5px]" />
    </div>
  ),
  th: (props: ComponentPropsWithoutRef<"th">) => <th {...props} className="border-b border-line bg-surface-2 px-4 py-2.5 font-semibold text-text" />,
  td: (props: ComponentPropsWithoutRef<"td">) => <td {...props} className="border-b border-line px-4 py-2.5 align-top text-muted" />,
  // Plain Markdown images (no known size). Prefer <Figure> for anything large.
  img: ({ alt = "", ...props }: ComponentPropsWithoutRef<"img">) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={alt} loading="lazy" className="my-1 h-auto max-w-full rounded-[14px] border border-line" />
  ),
  Callout,
  Figure,
};
