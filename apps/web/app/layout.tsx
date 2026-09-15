import type { Metadata } from "next";
import { Public_Sans, Source_Serif_4, Noto_Nastaliq_Urdu } from "next/font/google";

import "../styles/tokens.css";
import "../styles/globals.css";

/* Editorial serif for identity and headlines — V14 canonical typography. */
const display = Source_Serif_4({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

/* Legible sans for navigation, forms, numbers and tables — V14 canonical. */
const sans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

/* Nastaliq Urdu for wordmarks — part of the school's Kashmiri identity. */
const urdu = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  weight: ["400", "700"],
  variable: "--font-urdu",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

export const metadata: Metadata = {
  /* Concept domain until launch — same fallback as app/robots.ts and app/sitemap.ts. */
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://faizaam.example"),
  title: {
    default: "Faiz Aam Secondary School · Bandipora",
    template: "%s · Faiz Aam Secondary School",
  },
  description: "Campus website, admissions, and family portal for Faiz Aam Secondary School, Bandipora.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${urdu.variable}`}>
      <body>
        <nav aria-label="Skip navigation">
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
        </nav>
        {children}
      </body>
    </html>
  );
}
