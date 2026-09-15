import PublicHeader from "@/components/layouts/PublicHeader";
import PublicFooter from "@/components/layouts/PublicFooter";

/**
 * Public site frame — V14 aligned. The ribbon and site-head appear on
 * every public page (including the homepage). The hero sits below the
 * header on a paper ground, matching the V14 prototype.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader tone="light" />
      <main id="main" tabIndex={-1}>{children}</main>
      <PublicFooter />
    </>
  );
}
