import type { Metadata } from "next";

import { AdmissionsQueue } from "@/components/staff/AdmissionsQueue";
import { admissionsService } from "@/modules/services/admissions";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAdmissions } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Admissions",
};

export default async function StaffAdmissionsPage() {
  const supabaseMode = dataAdapter() === "supabase";
  const rows = supabaseMode ? await loadServerAdmissions() : await admissionsService.listStaffRecords();
  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Admissions</h1>
          <p className="ph-sub">
            Every application, its stage, and what it needs next. Approve from the detail page.
          </p>
        </div>
      </div>

      <AdmissionsQueue rows={rows} />

      {!supabaseMode ? (
        <p className="demo-note">Demo session · every application above is fictional concept data.</p>
      ) : null}
    </div>
  );
}
