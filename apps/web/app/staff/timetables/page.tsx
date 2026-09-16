import type { Metadata } from "next";
import { ACADEMICS_DEMO_NOTE } from "@/modules/academics/demo";
import { TimetableManager } from "@/components/staff/TimetableManager";
import { dataAdapter } from "@/lib/supabase/env";
import { getDemoDateSheet } from "@/modules/services/timetable";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Timetables",
};

export default function TimetablesPage() {
  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Timetables</h1>
          <p className="ph-sub">Effective-dated class timetables and exam date sheets.</p>
        </div>
      </div>

      <TimetableManager dateSheet={dataAdapter() === "supabase" ? [] : getDemoDateSheet()} />

      <div className={styles.ruleNote}>
        {dataAdapter() !== "supabase" ? (
          <p>{ACADEMICS_DEMO_NOTE} The editor, conflicts, and versions are session demo state · nothing is persisted
          server-side until the timetable backend connects.</p>
        ) : (
          <p>Timetable versions, conflicts, and overrides are validated and persisted through the school timetable service.</p>
        )}
      </div>
    </div>
  );
}
