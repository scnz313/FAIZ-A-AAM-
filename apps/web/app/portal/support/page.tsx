import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { SupportForm } from "@/components/portal/SupportForm";

import styles from "./page.module.css";

export default function SupportPage() {
  return (
    <div className={styles.page}>
      <header>
        <p className="eyebrow">Portal · Support</p>
        <h1 className={styles.title}>Support &amp; grievances</h1>
        <p className={styles.intro}>Raise a concern; the school office responds on school days.</p>
        <ActiveChildLine />
      </header>

      <div className={styles.grid}>
        <SupportForm />

        <aside className={`panel ${styles.contact}`} aria-labelledby="contact-heading">
          <h2 id="contact-heading" className={styles.contactTitle}>
            Contact the office
          </h2>
          <dl className={styles.contactRows}>
            <div className={styles.contactRow}>
              <dt>Phone</dt>
              <dd className="num">+91 000 000 0000</dd>
            </div>
            <div className={styles.contactRow}>
              <dt>Email</dt>
              <dd>office@faizaam.example</dd>
            </div>
            <div className={styles.contactRow}>
              <dt>Office hours</dt>
              <dd>Monday–Saturday · 09:00–15:00 IST</dd>
            </div>
            <div className={styles.contactRow}>
              <dt>Address</dt>
              <dd>School Road, Bandipora, J&amp;K 193502</dd>
            </div>
          </dl>
          <p className={styles.contactNote}>
            For urgent matters during school hours, call the office. Grievances sent here are answered
            within 3 working days.
          </p>
        </aside>
      </div>

      <p className={styles.demoNote}>
        <span className="demo-badge">Demo</span>
        <span>This form is fictional — nothing is sent. Real grievance handling arrives with the support backend.</span>
      </p>
    </div>
  );
}
