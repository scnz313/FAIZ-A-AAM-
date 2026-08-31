import type { Metadata } from "next";

import { AdmissionsQueue } from "@/components/staff/AdmissionsQueue";
import { admissionsService } from "@/modules/services/admissions";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAdmissions } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Admissions · Staff",
};

export default async function StaffAdmissionsPage() {
  const supabaseMode = dataAdapter() === "supabase";
  const rows = supabaseMode ? await loadServerAdmissions() : await admissionsService.listStaffRecords();
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Admissions</p>
        <h1 className="workspace-title">Admissions</h1>
        <p className="workspace-intro">Session 2026-27 · applications by status.</p>
      </header>

      <AdmissionsQueue rows={rows} />

      {!supabaseMode ? (
        <p className="demo-note">Demo session — every application above is fictional concept data.</p>
      ) : null}
    </div>
  );
}
