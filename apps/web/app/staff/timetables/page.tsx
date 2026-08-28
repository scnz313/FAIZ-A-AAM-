import type { Metadata } from "next";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { TimetableManager } from "@/components/staff/TimetableManager";
import { dataAdapter } from "@/lib/supabase/env";
import { getDemoDateSheet } from "@/modules/services/timetable";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Timetables · Staff",
};

export default function TimetablesPage() {
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Timetables</p>
        <h1 className="workspace-title">Timetables</h1>
        <p className="workspace-intro">Effective-dated class timetables and exam date sheets.</p>
      </header>

      <TimetableManager dateSheet={dataAdapter() === "supabase" ? [] : getDemoDateSheet()} />

      <div className={styles.ruleNote}>
        <p>{ACADEMICS_DEMO_NOTE} The editor, conflicts, and versions are session demo state — nothing is persisted
        server-side until the timetable backend connects.</p>
      </div>
    </div>
  );
}
