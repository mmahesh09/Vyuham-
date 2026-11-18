import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import "./globals.css";

import { geistMono, outfit } from "@/lib/fonts";
import { RSS_ALTERNATE } from "@/lib/site";
import { RootProviders } from "@/providers/root-providers";

const SITE_NAME = "Vyuham";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: `${SITE_NAME}: dashboards from your spreadsheets and databases`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Upload Excel or CSV files or connect PostgreSQL or MySQL, ask in plain English and get a chart with a one-line answer. Built for teams of 1 to 100.",
  applicationName: SITE_NAME,
  // Lets feed readers find the blog from any page.
  alternates: { types: RSS_ALTERNATE },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // next-themes sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} ${geistMono.variable} antialiased`}>
        <RootProviders>{children}</RootProviders>
        <Analytics />
      </body>
    </html>
  );
}
