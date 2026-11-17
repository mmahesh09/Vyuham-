import Link from "next/link";

import { formatDate, type PostMeta } from "@/lib/blog";

function PostByline({ post }: { post: PostMeta }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
      <time dateTime={post.date}>{formatDate(post.date)}</time>
      {post.updated && (
        <>
          <span aria-hidden>·</span>
          <span>
            Updated <time dateTime={post.updated}>{formatDate(post.updated)}</time>
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>{post.readingMinutes} min read</span>
      <span aria-hidden>·</span>
      <span>{post.author}</span>
      {post.draft && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Draft</span>}
    </p>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-1.5 pt-1">
      {tags.map((t) => (
        <span key={t} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-faint">
          {t}
        </span>
      ))}
    </p>
  );
}

/** The newest post, shown large at the top of the blog. */
export function FeaturedPost({ post }: { post: PostMeta }) {
  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group mt-10 flex flex-col gap-3 rounded-[18px] border border-line bg-surface p-7 transition-colors hover:border-highlight/50"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-highlight">Latest</p>
      <h2 className="font-display text-[clamp(26px,4vw,32px)] font-semibold leading-tight text-text transition-colors group-hover:text-highlight">
        {post.title}
      </h2>
      <p className="text-[16px] leading-[1.7] text-muted">{post.description}</p>
      <PostByline post={post} />
      <TagChips tags={post.tags} />
    </Link>
  );
}

export function PostList({ posts }: { posts: PostMeta[] }) {
  return (
    <ul className="flex flex-col">
      {posts.map((post) => (
        <li key={post.slug} className="border-b border-line">
          <Link href={`/blog/${post.slug}`} className="group flex flex-col gap-2.5 py-9">
            <PostByline post={post} />
            <h2 className="font-display text-[24px] font-semibold leading-snug text-text transition-colors group-hover:text-highlight">
              {post.title}
            </h2>
            <p className="text-[15.5px] leading-[1.7] text-muted">{post.description}</p>
            <TagChips tags={post.tags} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Tag filter: links to the static /blog/tag/<tag> pages, so every view stays prerendered. */
export function TagFilter({ tags, active }: { tags: string[]; active?: string }) {
  if (tags.length === 0) return null;
  const chip = "rounded-full border px-3 py-1 text-[13px] transition-colors";
  const on = "border-highlight bg-highlight/10 text-text";
  const off = "border-line text-muted hover:text-text";
  return (
    <nav aria-label="Filter posts by topic" className="flex flex-wrap gap-2 pt-8">
      <Link href="/blog" className={`${chip} ${active ? off : on}`} aria-current={active ? undefined : "page"}>
        All
      </Link>
      {tags.map((t) => (
        <Link
          key={t}
          href={`/blog/tag/${encodeURIComponent(t)}`}
          className={`${chip} ${t === active ? on : off}`}
          aria-current={t === active ? "page" : undefined}
        >
          {t}
        </Link>
      ))}
    </nav>
  );
}
