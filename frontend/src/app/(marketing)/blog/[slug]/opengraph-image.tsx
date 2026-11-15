import { ImageResponse } from "next/og";

import { formatDate, getAllPosts, getPost } from "@/lib/blog";

// The share image for a post (link previews on LinkedIn, WhatsApp, X…), built with the pages: at
// runtime on Vercel the content/ folder isn't there to read.
export const alt = "Vyuham blog post";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await getAllPosts()).map((p) => ({ slug: p.slug }));
}
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = await getPost((await params).slug);
  const title = post?.title ?? "Vyuham blog";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "radial-gradient(circle at 85% 0%, #3a1d0a 0%, #070504 60%)",
          color: "#fbf6f1",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "linear-gradient(#f58a42, #c85a17)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -1 }}>vyuham</div>
          <div style={{ fontSize: 24, color: "#a8978a", marginLeft: 10 }}>Blog</div>
        </div>
        <div style={{ display: "flex", fontSize: title.length > 60 ? 54 : 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -1.5 }}>
          {title}
        </div>
        <div style={{ display: "flex", fontSize: 26, color: "#ffb37a" }}>
          {post ? `${formatDate(post.date)} · ${post.readingMinutes} min read` : "AI dashboards for small teams"}
        </div>
      </div>
    ),
    size,
  );
}
