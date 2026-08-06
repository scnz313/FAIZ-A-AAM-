import type { Metadata } from "next";

/* Indexing protection — the wallboard is a display-only demonstrator. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Chromeless layout for the hallway wallboard: no facility sidebar or
 * topbar — the display is a full-screen surface (blueprint §5.14).
 */
export default function WallboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" tabIndex={-1}>
      {children}
    </main>
  );
}
