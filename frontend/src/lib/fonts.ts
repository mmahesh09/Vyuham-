import { Geist_Mono, Outfit } from "next/font/google";

// Outfit (Smartsheet Inc, Rodrigo Fuenzalida): the one typeface for the whole site. Variable, weights 100–900.
export const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], display: "swap" });
// Mono stays for code-like labels: eyebrows, timestamps, column names.
export const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
