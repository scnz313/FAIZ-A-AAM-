import type { ReactNode } from "react";

import Button from "@/components/ui/Button";
import { StarOrn } from "@/components/ui/StarOrn";
import type { HeroFields } from "./homeContent";
import styles from "./Hero.module.css";

const FALLBACK_KICKER = "Admissions 2027-28 · open this November";
const FALLBACK_LEDE =
  "Faiz E Aam Secondary School is a co-educational day school for Grades 1 to 12, where steady teaching, honest assessment and quiet order carry each student from the first day to the final year.";
const FALLBACK_PRIMARY_CTA = "Begin an admission application";
const FALLBACK_SECONDARY_CTA = "How admissions work";
const FALLBACK_NOTE =
  "Registration opens 1 November 2026. Seats per grade are limited and filled in order.";

/**
 * V15 hero — paper ground, contour lines, kicker, serif headline with italic
 * emphasis, accent + ghost CTAs, note, and the specimen record card with
 * star ornament and RECEIVED stamp. Staggered reveal (d1–d5) is disabled
 * under prefers-reduced-motion.
 *
 * Managed copy from the `home-hero` page overrides each field it supplies;
 * otherwise the institutional fallback renders unchanged. Structure, record
 * card, and StarOrn are never replaced by managed content.
 */
export default function Hero({ copy }: { copy?: HeroFields | null } = {}) {
  const kicker = copy?.kicker ?? FALLBACK_KICKER;
  const title: ReactNode = copy?.title ?? (
    <>
      Rooted in Bandipora, <em>measured</em> in every lesson.
    </>
  );
  const lede = copy?.lede ?? FALLBACK_LEDE;
  const primaryCta = copy?.primaryCta ?? FALLBACK_PRIMARY_CTA;
  const secondaryCta = copy?.secondaryCta ?? FALLBACK_SECONDARY_CTA;
  const note = copy?.note ?? FALLBACK_NOTE;

  return (
    <section className={styles.hero} aria-label="Welcome to Faiz E Aam Secondary School">
      <div className={styles.heroBg} aria-hidden="true">
        <svg viewBox="0 0 1440 640" preserveAspectRatio="xMidYMid slice" className={styles.contours}>
          <g fill="none" stroke="var(--ink)" strokeWidth="1">
            <path d="M0,520 C120,500 240,540 360,510 C480,480 600,520 720,490 C840,460 960,500 1080,470 C1200,440 1320,480 1440,450" opacity="0.07" />
            <path d="M0,560 C140,540 280,580 400,550 C520,520 640,560 760,530 C880,500 1000,540 1120,510 C1240,480 1360,520 1440,490" opacity="0.06" />
            <path d="M0,600 C160,580 300,620 440,590 C580,560 700,600 820,570 C940,540 1060,580 1180,550 C1300,520 1380,560 1440,530" opacity="0.05" />
            <path d="M0,440 C100,420 200,460 300,430 C400,400 500,440 600,410 C700,380 800,420 900,390 C1000,360 1100,400 1200,370 C1300,340 1380,380 1440,350" opacity="0.04" />
            <path d="M0,360 C120,340 240,380 360,350 C480,320 600,360 720,330 C840,300 960,340 1080,310 C1200,280 1320,320 1440,290" opacity="0.03" />
          </g>
          <circle cx="180" cy="200" r="3" fill="var(--saffron)" opacity="0.5" />
          <circle cx="1180" cy="180" r="3" fill="var(--saffron)" opacity="0.4" />
        </svg>
      </div>

      <div className={styles.inner}>
        <div className={styles.content}>
          <p className={`${styles.kicker} reveal d1`}>
            {kicker}
          </p>
          <h1 className={`${styles.title} reveal d2`}>
            {title}
          </h1>
          <p className={`${styles.lede} reveal d3`}>
            {lede}
          </p>
          <div className={`${styles.actions} reveal d4`}>
            <Button href="/admissions/apply" variant="saffron" size="lg">
              <span className="msym" aria-hidden="true">north_east</span>
              {primaryCta}
            </Button>
            <Button href="/admissions" variant="ghost" size="lg">
              {secondaryCta}
            </Button>
          </div>
          <p className={`${styles.note} reveal d5`}>
            <span className="msym" aria-hidden="true">info</span>
            {note}
          </p>
        </div>

        <div className="reveal d3">
          <div className={styles.recordCard}>
            <div className={styles.rcHead}>
              <span className={styles.rcLabel}>Admission record · specimen</span>
              <StarOrn size={13} />
            </div>
            <div className={styles.rcBody}>
              <div className={styles.rcRow}>
                <span className={styles.rcK}>Reference</span>
                <span className={`${styles.rcV} num`}>FA-2027-0142</span>
              </div>
              <div className={styles.rcRow}>
                <span className={styles.rcK}>Student</span>
                <span className={styles.rcV}>Mudasir Ahmad · Grade 6</span>
              </div>
              <div className={styles.rcRow}>
                <span className={styles.rcK}>Session</span>
                <span className={`${styles.rcV} num`}>2027-28</span>
              </div>
              <div className={styles.rcRow}>
                <span className={styles.rcK}>Documents</span>
                <span className={styles.rcV}>2 of 2 verified</span>
              </div>
              <div className={styles.rcRow}>
                <span className={styles.rcK}>Status</span>
                <span className={`${styles.rcV} ${styles.rcStatus}`}>Submitted · in review</span>
              </div>
            </div>
            <div className={styles.stamp} aria-hidden="true">
              <svg width="92" height="92" viewBox="0 0 100 100" fill="none">
                <circle cx="50" cy="50" r="46" stroke="var(--willow)" strokeWidth="2.5" opacity="0.8" />
                <circle cx="50" cy="50" r="34" stroke="var(--willow)" strokeWidth="1" opacity="0.7" />
                <text x="50" y="47" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--willow)" fontFamily="Public Sans, sans-serif" letterSpacing="2">RECEIVED</text>
                <text x="50" y="62" textAnchor="middle" fontSize="8.5" fill="var(--willow)" fontFamily="Public Sans, sans-serif" letterSpacing="1">02 SEP 2026</text>
              </svg>
            </div>
          </div>
          <p className={styles.recordNote}>
            One record carries each application, invoice, receipt, result and timetable.
            The same care runs through everything you will use here.
          </p>
        </div>
      </div>
    </section>
  );
}
