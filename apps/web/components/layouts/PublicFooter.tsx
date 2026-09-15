import Link from "next/link";

import { Crest } from "@/components/ui/Crest";

const SCHOOL_COLUMN = [
  { label: "About", href: "/about" },
  { label: "Academics", href: "/academics" },
  { label: "School life", href: "/school-life" },
  { label: "Notices", href: "/notices" },
] as const;

const SERVICES_COLUMN = [
  { label: "Apply for admission", href: "/admissions/apply" },
  { label: "Pay fees", href: "/portal/fees" },
  { label: "View results", href: "/portal/results" },
  { label: "See timetable", href: "/portal/timetable" },
] as const;

const INFORMATION_COLUMN = [
  { label: "Disclosure", href: "/disclosure" },
  { label: "Careers", href: "/careers" },
  { label: "Contact", href: "/contact" },
  { label: "Policies & fees", href: "/policies/fees-and-refunds" },
] as const;

/** V15 ink-ground footer: one constrained wrap, brand record, three columns. */
export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="wrap">
        <div className="public-footer-grid">
          <div className="public-footer-brand">
            <Crest size="lg" tone="chalk" />
            <div className="public-footer-brand-copy">
              <p className="public-footer-name">Faiz E Aam Secondary School</p>
              <p className="urdu public-footer-urdu" dir="rtl" lang="ur">
                فیض عام · رَبِّ زِدْنِي عِلْمًا
              </p>
              <p className="public-footer-address">
                O Allah! Increase me in knowledge. A Unit of Darul Uloom Raheemiyyah, Bandipora, Jammu &amp; Kashmir 193502.
              </p>
            </div>
          </div>

          <FooterColumn title="School" links={SCHOOL_COLUMN} />
          <FooterColumn title="Services" links={SERVICES_COLUMN} />
          <FooterColumn title="Information" links={INFORMATION_COLUMN} />
        </div>

        <div className="public-footer-bottom">
          <span>© 2026 Faiz E Aam Secondary School, Bandipora. A Unit of Darul Uloom Raheemiyyah.</span>
          <Link href="/policies/fees-and-refunds" prefetch={false}>Policies &amp; fees</Link>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: ReadonlyArray<{ label: string; href: string }> }) {
  return (
    <nav className="public-footer-col" aria-label={title}>
      <h2>{title}</h2>
      {links.map((link) => (
        <Link key={link.label} href={link.href} prefetch={false}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export default PublicFooter;
