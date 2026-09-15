import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import RuledList, { type RuledRow } from "@/components/public/pages/RuledList";
import ConceptNote from "@/components/public/pages/ConceptNote";
import { formatUpdatedDate, type ManagedPageBody } from "@/components/public/pages/PolicyPage";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Mandatory Public Disclosure",
  description:
    "Mandatory public disclosures · affiliation, fee schedule, staff details, and more · as they are verified by the school.",
  alternates: { canonical: "/disclosure" },
};

const DISCLOSURES: readonly RuledRow[] = [
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
      <Link className="link-arrow" href="/policies/fees-and-refunds">
        Fees &amp; refunds policy <span aria-hidden="true">→</span>
      </Link>
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
];

type ManagedDisclosureItem = {
  term: string;
  line: string | null;
  pendingVerification: boolean;
  link: { href: string; label: string; external: boolean } | null;
};

const PENDING_VERIFICATION = /^pending verification$/i;
const ROUTE_REFERENCE = /^\/[A-Za-z0-9/_?#=&.%-]*$/;
const DOCUMENT_REFERENCE = /^DOC-[A-Za-z0-9-]+$/;

function parseManagedDisclosureItems(body: string[] | null | undefined): ManagedDisclosureItem[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry !== "")
    .map((entry) => {
      const segments = entry
        .split("·")
        .map((segment) => segment.trim())
        .filter((segment) => segment !== "");
      const term = segments[0] ?? entry;
      const remainder = segments.slice(1);
      const pendingVerification = remainder.some((segment) => PENDING_VERIFICATION.test(segment));
      let link: ManagedDisclosureItem["link"] = null;
      const lineParts: string[] = [];
      for (const segment of remainder) {
        if (PENDING_VERIFICATION.test(segment)) continue;
        if (ROUTE_REFERENCE.test(segment)) {
          link = { href: segment, label: lineParts.length === 0 ? term : lineParts.join(" · "), external: false };
          continue;
        }
        if (DOCUMENT_REFERENCE.test(segment)) {
          link = {
            href: `/api/documents/${encodeURIComponent(segment)}`,
            label: lineParts.length === 0 ? term : lineParts.join(" · "),
            external: true,
          };
          continue;
        }
        lineParts.push(segment);
      }
      return {
        term,
        line: link === null && lineParts.length > 0 ? lineParts.join(" · ") : null,
        pendingVerification,
        link,
      };
    });
}

function ManagedDetail({ item }: { item: ManagedDisclosureItem }) {
  const badge = item.pendingVerification ? <StatusBadge tone="neutral">Pending verification</StatusBadge> : null;
  const link = item.link;
  const linkContent = link === null ? null : (
    <>
      {link.label} <span aria-hidden="true">→</span>
    </>
  );
  const linkNode =
    link === null ? null : link.external ? (
      <a className="link-arrow" href={link.href}>
        {linkContent}
      </a>
    ) : (
      <Link className="link-arrow" href={link.href}>
        {linkContent}
      </Link>
    );
  if (badge === null && linkNode === null) {
    return item.line === null ? null : <span>{item.line}</span>;
  }
  return (
    <>
      {badge}
      {linkNode}
    </>
  );
}

function managedDisclosureRows(items: readonly ManagedDisclosureItem[]): RuledRow[] {
  return items.map((item) => ({ term: item.term, detail: <ManagedDetail item={item} /> }));
}

export default async function DisclosurePage() {
  let managed: ManagedPageBody | null = null;
  if (dataAdapter() === "supabase") {
    try {
      managed = await loadServerPublicPageBody("disclosure");
    } catch {
      managed = null;
    }
  }
  const items = parseManagedDisclosureItems(managed?.body);
  const managedPage = managed !== null && managed.title.trim() !== "" && items.length > 0 ? managed : null;
  const managedTitle = managedPage === null ? null : managedPage.title.trim();
  const updatedLabel = managedPage === null ? null : formatUpdatedDate(managedPage.updatedAtIso);

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Transparency"
        title={managedTitle ?? "Mandatory public disclosure"}
        deck={
          managedPage === null
            ? "Required disclosures will be published here as they are verified."
            : updatedLabel === null
              ? "Published by the school through the content workspace."
              : `Updated ${updatedLabel}`
        }
      />

      <PageSection label="Disclosures" heading="What is published here" headingId="disclosure-heading">
        <p className={styles.intro}>
          {managedPage === null
            ? "The school will publish the documents it is required to make public · affiliation, school code, fee schedule, staff details, safety certificates, and the annual report · on this page, as they are verified. Nothing below states an official number or a confirmed document."
            : "The school publishes its required disclosures on this page. Each item appears as published, and a verification status is shown only where the school has stated one."}
        </p>
        <RuledList rows={managedPage === null ? DISCLOSURES : managedDisclosureRows(items)} label="Disclosure status" />
      </PageSection>

      <ConceptNote>
        No official disclosure numbers, codes, or documents are published on this page.
      </ConceptNote>
    </div>
  );
}
