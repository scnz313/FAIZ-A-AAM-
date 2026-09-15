import type { Metadata } from "next";

import PageIntro from "@/components/public/PageIntro";
import PageSection from "@/components/public/pages/PageSection";
import ConceptNote from "@/components/public/pages/ConceptNote";
import { GrievanceForm } from "@/components/public/GrievanceForm";
import { MapScene } from "@/components/ui/art";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Address, phone, email, and office hours for Faiz E Aam Secondary School, Bandipora.",
  alternates: { canonical: "/contact" },
};

const OFFICE_HOURS = [
  { when: "School days", hours: "09:00 – 15:00" },
  { when: "Lunch break", hours: "13:00 – 14:00" },
  { when: "Sundays and holidays", hours: "Closed" },
] as const;

export default function ContactPage() {
  return (
    <div className={styles.page}>
      <PageIntro
        eyebrow="Reach the school"
        title="Contact"
        deck="The office is open on school days, 09:00 to 15:00."
      />

      <PageSection label="Office" heading="Contact" headingId="contact-heading">
        <div className={styles.grid}>
          <div className={`panel ${styles.officePanel}`}>
            <p className={styles.panelHead}>
              <span className="kicker">The office</span>
              <span className="demo-badge">Fictional</span>
            </p>
            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt>Address</dt>
                <dd>
                  Faiz E Aam Secondary School, Bandipora, Jammu &amp; Kashmir
                  193502
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Phone</dt>
                <dd>
                  <a href="tel:+919000000000">+91 90000 00000</a>
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Email</dt>
                <dd>
                  <a href="mailto:office@faizaam.example">office@faizaam.example</a>
                </dd>
              </div>
            </dl>
            <p className={styles.grievance}>
              <a className="link-arrow" href="#grievance-heading">
                Raise a concern <span aria-hidden="true">↓</span>
              </a>
            </p>
          </div>

          <figure className={`panel ${styles.mapPanel}`}>
            <MapScene ariaHidden className={styles.mapArt} />
            <figcaption className={styles.mapCaption}>
              Illustrated map · official location pending verification.
            </figcaption>
          </figure>
        </div>
      </PageSection>

      <PageSection label="Hours" heading="Office hours" headingId="hours-heading">
        <div className={`panel ${styles.hoursPanel}`}>
          <table className="table">
            <caption className="sr-only">Office hours</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Hours</th>
              </tr>
            </thead>
            <tbody>
              {OFFICE_HOURS.map((row) => (
                <tr key={row.when}>
                  <td>{row.when}</td>
                  <td className="num">{row.hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection label="Concern" heading="Raise a concern" headingId="grievance-heading">
        <GrievanceForm />
      </PageSection>

      <ConceptNote>
        Address, phone, email, and office hours are fictional concept data —
        to be confirmed by the school. The concern form is a demo: nothing is
        sent, and submissions stay in this browser session.
      </ConceptNote>
    </div>
  );
}
