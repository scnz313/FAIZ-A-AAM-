import type { Policy } from "@/modules/content/demo";
import PageIntro from "@/components/public/PageIntro";
import ConceptNote from "./ConceptNote";
import styles from "./PolicyPage.module.css";

export type ManagedPageBody = { title: string; body: string[]; updatedAtIso: string | null };

export type PolicyPageSection = { heading: string | null; body: string[] };

export type PolicyPageView = {
  title: string;
  updatedLabel: string | null;
  sections: PolicyPageSection[];
  managed: boolean;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "2026-07-01" -> "1 July 2026", deterministic regardless of timezone. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

const KOLKATA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function kolkataDateIso(value: string | null): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return KOLKATA_DATE.format(parsed);
}

export function formatUpdatedDate(value: string | null): string | null {
  const iso = kolkataDateIso(value);
  return iso === null ? null : formatDate(iso);
}

function cleanBody(body: unknown): string[] {
  if (!Array.isArray(body)) return [];
  return body
    .map((paragraph) => (typeof paragraph === "string" ? paragraph.trim() : ""))
    .filter((paragraph) => paragraph !== "");
}

export function resolvePolicyPageView(policy: Policy, managed: ManagedPageBody | null): PolicyPageView {
  const paragraphs = cleanBody(managed?.body);
  if (managed === null || managed.title.trim() === "" || paragraphs.length === 0) {
    return {
      title: policy.title,
      updatedLabel: formatUpdatedDate(policy.updatedIso),
      sections: policy.sections.map((section) => ({ heading: section.heading, body: [...section.body] })),
      managed: false,
    };
  }
  return {
    title: managed.title.trim(),
    updatedLabel: formatUpdatedDate(managed.updatedAtIso),
    sections: paragraphs.map((paragraph) => ({ heading: null, body: [paragraph] })),
    managed: true,
  };
}

/**
 * Shared renderer for the four policy pages. Each route passes its fallback
 * policy record and, in Supabase mode, the published managed page body.
 */
export default function PolicyPage({ policy, managed = null }: { policy: Policy; managed?: ManagedPageBody | null }) {
  const view = resolvePolicyPageView(policy, managed);
  return (
    <>
      <PageIntro
        eyebrow="Policies"
        title={view.title}
        deck={view.updatedLabel === null ? undefined : `Updated ${view.updatedLabel}`}
      />
      {view.sections.map((section, index) => (
        <section key={section.heading ?? `managed-section-${index}`} className={styles.section}>
          {section.heading === null ? null : <h2 className={styles.heading}>{section.heading}</h2>}
          <div className={styles.body}>
            {section.body.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
          </div>
        </section>
      ))}
      {view.managed ? (
        <p className={styles.printLine}>
          <span className="kicker">Published</span>
          This page is published by the school through the content workspace.
        </p>
      ) : (
        <p className={styles.printLine}>
          <span className="kicker">Print</span>
          This page is set for printing · a dated PDF will be published here once the school confirms the final text.
        </p>
      )}
      <ConceptNote />
    </>
  );
}
