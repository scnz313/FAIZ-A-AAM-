"use client";

import { usePathname } from "next/navigation";

import PublicHeader from "@/components/layouts/PublicHeader";
import PublicFooter from "@/components/layouts/PublicFooter";

/**
 * Public site frame. The homepage hero renders its own ink PublicHeader
 * (tone="dark"), so "/" must not double-render the header; every other
 * public page gets the light header. The footer appears on all pages.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <>
      {isHome ? null : <PublicHeader tone="light" />}
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicFooter />
    </>
  );
}
