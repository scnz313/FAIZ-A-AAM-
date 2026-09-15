import { ActiveChildLine } from "@/components/portal/ActiveChildLine";
import { SupportForm } from "@/components/portal/SupportForm";
import { dataAdapter } from "@/lib/supabase/env";

import styles from "./page.module.css";

export default function SupportPage() {
  const supabaseMode = dataAdapter() === "supabase";
  return (
    <div className={styles.page}>
      {/* V14 PageHead */}
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Support</h1>
          <p className="ph-sub">
            Write to the office about the active child&apos;s records, fees or anything else. You will always have a reference to come back to.
          </p>
          <ActiveChildLine />
        </div>
      </div>

      {/* V14 g32 grid: form on left, contact info on right */}
      <div className="grid g32">
        <section className="panel">
          <div className="pn-head"><h2>New request</h2></div>
          <div className="pn-body">
            <SupportForm />
          </div>
        </section>

        <div className="stack" style={{ gap: 18 }}>
          <section className="panel">
            <div className="pn-head"><h2>Contact the office</h2></div>
            <div className="pn-body" style={{ paddingTop: 12 }}>
              <dl className="kv">
                <dt>Phone</dt>
                <dd className="num"><a href="tel:+919000000000">+91 90000 00000</a></dd>
                <dt>Email</dt>
                <dd><a href="mailto:office@faizaam.example">office@faizaam.example</a></dd>
                <dt>Office hours</dt>
                <dd>Monday–Saturday · 09:00–15:00 IST</dd>
                <dt>Address</dt>
                <dd>School Road, Bandipora, J&amp;K 193502</dd>
              </dl>
            </div>
          </section>
          <div className="callout">
            <span className="msym" style={{ fontSize: 20, flex: "none", marginTop: 1, color: "var(--ink-3)" }}>schedule</span>
            <span className="small">
              Response times: two working days (school days). The office may ask for a correction request through this same thread so everything stays in one place.
            </span>
          </div>
        </div>
      </div>

      {!supabaseMode ? (
        <p className={styles.demoNote}>
          <span className="demo-badge">Demo</span>
          <span>This form is fictional · nothing is sent. Real grievance handling arrives with the support backend.</span>
        </p>
      ) : null}
    </div>
  );
}
