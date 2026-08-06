import { ChinarMark } from "@/components/ui/ChinarMark";
import { Crest } from "@/components/ui/Crest";
import GirihPattern from "@/components/ui/GirihPattern";

const SCHOOL_COLUMN = [
  { label: "About", href: "/about" },
  { label: "Academics", href: "/academics" },
  { label: "School life", href: "/school-life" },
  { label: "Contact", href: "/contact" },
  { label: "Disclosure", href: "/disclosure" },
] as const;

const FAMILIES_COLUMN = [
  { label: "Admissions", href: "/admissions" },
  { label: "Pay fees", href: "/portal/fees" },
  { label: "Portal", href: "/portal" },
  { label: "Notices", href: "/notices" },
  { label: "Careers", href: "/careers" },
] as const;

const POLICIES_COLUMN = [
  { label: "Privacy", href: "/policies/privacy" },
  { label: "Accessibility", href: "/policies/accessibility" },
  { label: "Fees & refunds", href: "/policies/fees-and-refunds" },
  { label: "Terms", href: "/policies/terms" },
] as const;

/** Ink ground footer with brand, four link columns and the concept note. */
export function PublicFooter() {
  return (
    <footer className="public-footer">
      <GirihPattern tone="chalk" opacity={0.035} className="public-footer-pattern" />
      {/* Faint chinar watermark, bottom right — decorative. */}
      <ChinarMark size={220} tone="chalk" className="public-footer-watermark" />

      <div className="public-footer-grid">
        <div className="public-footer-brand">
          <Crest size="lg" tone="chalk" />
          <p className="public-footer-name">Faiz Aam Secondary School</p>
          <p className="public-footer-tag">Secondary School · Bandipora</p>
          <p className="urdu public-footer-urdu" dir="rtl" lang="ur">
            فیض عام سکینڈری اسکول
          </p>
          <div className="public-footer-motto">
            <span className="public-footer-motto__rule" />
            <span className="public-footer-motto__line">
              <ChinarMark size={14} tone="saffron" />
              Learning for all
            </span>
          </div>
        </div>

        <nav className="public-footer-col" aria-label="School">
          <h2 className="section-label section-label--on-ink">School</h2>
          {SCHOOL_COLUMN.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <nav className="public-footer-col" aria-label="Families">
          <h2 className="section-label section-label--on-ink">Families</h2>
          {FAMILIES_COLUMN.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <nav className="public-footer-col" aria-label="Policies">
          <h2 className="section-label section-label--on-ink">Policies</h2>
          {POLICIES_COLUMN.map((link) => (
            <a key={link.label} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="public-footer-col">
          <h2 className="section-label section-label--on-ink">Contact</h2>
          <p>School Road, Bandipora</p>
          <p>Jammu &amp; Kashmir 193502</p>
          <p>+91 000 000 0000</p>
          <p>office@faizaam.example</p>
        </div>
      </div>

      <div className="public-footer-bottom">
        <p>© 2026 Faiz Aam Secondary School · Concept interface — all details fictional until verified</p>
      </div>
    </footer>
  );
}

export default PublicFooter;
