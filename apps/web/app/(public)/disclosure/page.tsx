import type { Metadata } from "next";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import RuledList from "@/components/public/pages/RuledList";
import ConceptNote from "@/components/public/pages/ConceptNote";
import { StatusBadge } from "@/components/ui/StatusBadge";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Mandatory Public Disclosure",
  description:
    "Mandatory public disclosures — affiliation, fee schedule, staff details, and more — as they are verified by the school.",
};

const DISCLOSURES = [
  {
    term: "Affiliation",
    detail: <StatusBadge tone="neutral">Pending verification</StatusBadge>,
  },
  {
    term: "School code",
    detail: <StatusBadge tone="neutral">Pending verification</StatusBadge>,
  },
  {
    term: "Fee schedule",
    detail: (
      <a className="link-arrow" href="/policies/fees-and-refunds">
        Fees &amp; refunds policy <span aria-hidden="true">→</span>
      </a>
    ),
  },
  {
    term: "Staff details",
    detail: <StatusBadge tone="neutral">Pending verification</StatusBadge>,
  },
  {
    term: "Safety certificates",
    detail: <StatusBadge tone="neutral">Pending verification</StatusBadge>,
  },
  {
    term: "Annual report",
    detail: <StatusBadge tone="neutral">Pending verification</StatusBadge>,
  },
] as const;

export default function DisclosurePage() {
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Transparency"
        title="Mandatory public disclosure"
        deck="Required disclosures will be published here as they are verified."
      />

      <PageSection label="Disclosures" heading="What is published here" headingId="disclosure-heading">
        <p className={styles.intro}>
          The school will publish the documents it is required to make
          public — affiliation, school code, fee schedule, staff details,
          safety certificates, and the annual report — on this page, as they
          are verified. Nothing below states an official number or a
          confirmed document.
        </p>
        <RuledList rows={DISCLOSURES} label="Disclosure status" />
      </PageSection>

      <ConceptNote>
        No official disclosure numbers, codes, or documents are published on
        this page.
      </ConceptNote>
    </div>
  );
}
