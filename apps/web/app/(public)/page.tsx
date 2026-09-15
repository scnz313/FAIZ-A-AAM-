import type { Metadata } from "next";
import Link from "next/link";

import AlertStrip, { selectUrgentNotice } from "@/components/public/AlertStrip";
import Hero from "@/components/public/Hero";
import NoticeLine from "@/components/public/NoticeLine";
import ServiceRail from "@/components/public/ServiceRail";
import SchoolStory from "@/components/public/SchoolStory";
import SchoolLife from "@/components/public/SchoolLife";
import UpcomingDates from "@/components/public/UpcomingDates";
import {
  HOME_CONTENT_SLUGS,
  mergeHeroCopy,
  selectAdmissionHeroCopy,
  selectHeroFields,
  selectManagedItems,
  selectStoryFields,
  type ManagedHomePages,
  type ManagedPage,
} from "@/components/public/homeContent";
import { demoNowIso } from "@/modules/demo/clock";
import { contentService } from "@/modules/services/content";
import { dataAdapter } from "@/lib/supabase/env";
import {
  loadServerPublicAdmissionConfiguration,
  loadServerPublicContent,
  loadServerPublicPageBody,
} from "@/lib/supabase/server-loaders";
import styles from "./page.module.css";

export const metadata: Metadata = {
  description:
    "Admissions, school life, notices, and upcoming dates for Faiz E Aam Secondary School, Bandipora.",
  alternates: { canonical: "/" },
};

const STAGES = [
  { grade: "Grades 1 to 5", name: "Primary", line: "Foundational literacy and numeracy, taught with patience, routine and quiet order." },
  { grade: "Grades 6 to 8", name: "Middle", line: "Wider subjects, study habits and honest feedback as independence begins." },
  { grade: "Grades 9 to 10", name: "Secondary", line: "Board-facing years with structured revision, tutorials and steady mentoring." },
  { grade: "Grades 11 to 12", name: "Higher Secondary", line: "Specialised streams, university guidance and responsible self-study." },
] as const;

/** Load one published managed page body. A missing page or a loader failure
 *  falls back silently to the institutional copy; the home page never fails
 *  because a section page is absent. */
async function loadManagedPage(slug: string): Promise<ManagedPage | null> {
  try {
    const page = await loadServerPublicPageBody(slug);
    return page === null ? null : { title: page.title, body: page.body };
  } catch {
    return null;
  }
}

/** Supabase mode reads published page bodies per slug. Demo mode always
 *  renders the current institutional copy. */
async function loadManagedHomePages(): Promise<ManagedHomePages> {
  const [hero, services, story, life] = await Promise.all([
    loadManagedPage(HOME_CONTENT_SLUGS.hero),
    loadManagedPage(HOME_CONTENT_SLUGS.services),
    loadManagedPage(HOME_CONTENT_SLUGS.story),
    loadManagedPage(HOME_CONTENT_SLUGS.life),
  ]);
  return { hero, services, story, life };
}

export default async function HomePage() {
  /* Public notices: the anonymous-safe server projection in Supabase mode,
     the session-backed fixture store in demo mode (the same pattern the
     notices and portal pages use). Managed section pages are loaded in the
     same pass; demo mode always keeps the institutional copy. */
  const supabaseMode = dataAdapter() === "supabase";
  const [notices, managed, admissionHero] = await Promise.all([
    supabaseMode ? loadServerPublicContent().catch(() => []) : contentService.listForAudience("public"),
    supabaseMode ? loadManagedHomePages() : Promise.resolve(null),
    /* The hero names the live admission window instead of a hardcoded
       session: an unreadable configuration keeps the honest generic line. */
    supabaseMode
      ? loadServerPublicAdmissionConfiguration().then(selectAdmissionHeroCopy).catch(() => selectAdmissionHeroCopy(null))
      : Promise.resolve(null),
  ]);

  const nowIso = supabaseMode ? new Date().toISOString() : demoNowIso();

  /* C5 owner decision: an alert is the latest urgent, published, non-expired
     notice, and only then does the strip render. */
  const urgentNotice = selectUrgentNotice(notices, nowIso);

  /* C6 owner decision: a published managed page overrides a section's copy
     field by field; a missing or empty page keeps today's copy. In Supabase
     mode the computed kicker and note sit under the managed page so the
     window facts stay live unless the school publishes its own line. */
  const hero = mergeHeroCopy(admissionHero, selectHeroFields(managed?.hero ?? null));
  const services = selectManagedItems(managed?.services ?? null);
  const story = selectStoryFields(managed?.story ?? null);
  const life = selectManagedItems(managed?.life ?? null);

  /* Composition: the strip sits above the hero so an urgent notice is the
     first content after the header. NoticeLine below receives the same
     page-loaded notices with the alert slug excluded, so it shows the latest
     non-urgent published notice and the alert never appears twice. */
  return (
    <>
      <div className={`wrap ${styles.alertSlot}`}>
        <AlertStrip
          notice={
            urgentNotice === null
              ? null
              : {
                  title: urgentNotice.title,
                  excerpt: urgentNotice.excerpt,
                  dateIso: urgentNotice.dateIso,
                  href: `/notices/${urgentNotice.slug}`,
                }
          }
        />
      </div>
      <Hero copy={hero} />
      <section className="sec" aria-label="Quick services">
        <div className="wrap">
          <ServiceRail items={services} />
          <div style={{ marginTop: 26 }}>
            <NoticeLine notices={notices} excludeSlug={urgentNotice?.slug} />
          </div>
        </div>
      </section>
      <SchoolStory content={story} />
      <section className="sec" aria-label="Learning stages">
        <div className="wrap">
          <div className="sec-head">
            <h2>Four stages, one continuous record.</h2>
            <Link className="arrow-link" href="/academics">
              Curriculum &amp; academics <span className="msym" aria-hidden="true">arrow_forward</span>
            </Link>
          </div>
          <ol className={styles.stageList}>
            {STAGES.map((stage) => (
              <li key={stage.name} className={styles.stageRow}>
                <span className={`${styles.stageGrade} num`}>{stage.grade}</span>
                <h3 className={styles.stageName}>{stage.name}</h3>
                <p className={styles.stageLine}>{stage.line}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <SchoolLife items={life} />
      <UpcomingDates notices={notices} nowIso={nowIso} />
      <section className="sec" aria-label="Visit">
        <div className="wrap">
          <div className={styles.ctaBand}>
            <div>
              <h2 className={styles.ctaHeading}>Come and see the school before you decide.</h2>
              <p className={styles.ctaSub}>
                The office welcomes visits on weekdays during school hours. Bring your questions; admission is not decided on the doorstep.
              </p>
            </div>
            <div className={styles.ctaActions}>
              <Link className={styles.ctaPaper} href="/contact">Contact the office</Link>
              <Link className={styles.ctaOutline} href="/admissions">Read admissions first</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
