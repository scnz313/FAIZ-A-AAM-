import type { Metadata } from "next";
import Link from "next/link";

import PageIntro from "@/components/public/PageIntro";
import ConceptNote from "@/components/public/pages/ConceptNote";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerPublicPageBody } from "@/lib/supabase/server-loaders";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "About",
  description:
    "What Faiz Aam Secondary School is, how it teaches, and what remains to be confirmed.",
  alternates: { canonical: "/about" },
};

const FACTS: ReadonlyArray<readonly [string, string]> = [
  ["Unit of", "Darul Uloom Raheemiyyah"],
  ["Grades", "1 to 12 · co-educational day school"],
  ["Medium", "English · Urdu and Kashmiri taught"],
  ["Session", "April to March"],
  ["Location", "Astanpora, Bandipora"],
  ["Governance", "Darul Uloom Raheemiyyah governing body"],
];

const PAGE_SECTIONS = [
  ["history", "History"],
  ["approach", "Mission and approach"],
  ["leadership", "Leadership and governance"],
] as const;

export default async function AboutPage() {
  /* A published managed page overrides the concept copy; otherwise the
     concept page remains the honest fallback. */
  const managed = dataAdapter() === "supabase" ? await loadServerPublicPageBody("about") : null;
  if (managed !== null) {
    return (
      <div className={styles.page}>
        <PageIntro eyebrow="The school" title={managed.title} deck={managed.body[0] ?? ""} />
        <section className="sec">
          <div className="wrap">
            <div className={styles.story}>
              {managed.body.slice(1).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          </div>
        </section>
        <ConceptNote>This page is published by the school through the content workspace.</ConceptNote>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="About"
        title="A school kept like a record: honestly, and in order."
        deck="Faiz Aam Secondary School is a unit of Darul Uloom Raheemiyyah, Bandipora. This page states what the school is, how it teaches, and what remains to be confirmed."
      />

      <section className="sec">
        <div className="wrap">
          <div className="g34">
            <div className={styles.narrative}>
              <section id="history" aria-labelledby="about-history-heading">
                <h2 id="about-history-heading">History</h2>
                <p>
                  The school was established as the general-education unit of Darul Uloom
                  Raheemiyyah, serving families of Bandipora who wanted classical seriousness
                  and a modern syllabus taught together. It grew grade by grade, kept its
                  intake deliberately measured, and remains answerable to the same governing
                  body as the institution that founded it.
                </p>
                <p>
                  Rooms have been added, a laboratory built, a computer room wired. The
                  intention has not changed: teach steadily, assess honestly, and keep parents
                  informed through records rather than rumours.
                </p>
              </section>

              <section id="approach" aria-labelledby="about-approach-heading">
                <h2 id="about-approach-heading">Mission and approach</h2>
                <p className={styles.mission}>
                  Knowledge before marks; marks before boasts. Every child is known by name,
                  every subject is taught from a plan, and every claim the school makes can be
                  checked in a record.
                </p>
                <p>
                  Teaching follows a published scheme of work per subject and grade. Assessment
                  runs through the term rather than only at its end, and written feedback
                  reaches guardians through the portal as it is recorded. Remedial time is
                  timetabled, not improvised. Arabic and Islamic studies sit alongside the
                  state curriculum with their own timetable allocation.
                </p>
              </section>

              <section id="leadership" aria-labelledby="about-leadership-heading">
                <h2 id="about-leadership-heading">Leadership and governance</h2>
                <p>
                  Day-to-day academic leadership rests with the Principal, working within the
                  policies of the governing body. Appointments, finance and statutory
                  compliance are overseen by the Administrator&rsquo;s office under the same
                  body.
                </p>
              </section>

              <ConceptNote>
                This website is part of a design prototype. Text describing the
                school&rsquo;s history, leadership and calendar is illustrative and awaits the
                school&rsquo;s confirmation; the structure of these pages is the deliverable,
                not the specific wording.
              </ConceptNote>
            </div>

            <aside className={styles.aside} aria-label="School record summary">
              <div className="record-card">
                <div className="rc-head">
                  <span className="t">School record</span>
                </div>
                <div className="rc-body">
                  <div className="facts-ledger" style={{ borderTop: 0 }}>
                    {FACTS.map(([k, v]) => (
                      <div className="fl-row" key={k}>
                        <span className="k">{k}</span>
                        <span className="v">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="callout warn">
                <span className="msym" style={{ fontSize: 20, flex: "none", marginTop: 1, color: "var(--saffron-ink)" }}>
                  pending_actions
                </span>
                <span className="small">
                  <strong>Verification pending.</strong> Named office bearers, their
                  appointment records and the affiliation number will be published on the
                  disclosure page once confirmed by the school office. No names are shown here
                  as confirmed until that check is complete.
                </span>
              </div>

              <section className="panel" aria-label="On this page">
                <div className="pn-head">
                  <h2>On this page</h2>
                </div>
                <div className="pn-body flush">
                  {PAGE_SECTIONS.map(([id, label]) => (
                    <a className="row-between" style={{ padding: "11px 18px", borderBottom: "1px solid var(--line-soft)" }} href={`#${id}`} key={id}>
                      <span className="small strong">{label}</span>
                      <span className="msym" style={{ fontSize: 16, color: "var(--muted)" }}>arrow_forward</span>
                    </a>
                  ))}
                  <Link className="row-between" style={{ padding: "11px 18px" }} href="/disclosure">
                    <span className="small strong">Statutory disclosure</span>
                    <span className="chip">Pending confirmation</span>
                  </Link>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
