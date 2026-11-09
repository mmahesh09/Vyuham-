import type { Metadata } from "next";
import "./globals.css";

import { geistMono, outfit } from "@/lib/fonts";
import { RootProviders } from "@/providers/root-providers";

const SITE_NAME = "Vyuham";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: `${SITE_NAME} — AI dashboards for small businesses`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Upload Excel, CSV or Google Sheets, ask questions in plain English and get the answer plus a chart. An AI dashboard built for teams of 1–100.",
  applicationName: SITE_NAME,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // next-themes sets the theme class on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <body className={`${outfit.variable} ${geistMono.variable} antialiased`}>
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
