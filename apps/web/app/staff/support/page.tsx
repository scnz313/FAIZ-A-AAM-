import { GrievanceInbox } from "@/components/staff/GrievanceInbox";
import { SUPPORT_DEMO_NOTE } from "@/modules/support/demo";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerSupport } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export default async function SupportPage() {
  const supabaseMode = dataAdapter() === "supabase";
  const initialItems = supabaseMode ? await loadServerSupport("staff") : undefined;
  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Grievances</h1>
          <p className="ph-sub">Parent and applicant concerns, in order of arrival.</p>
        </div>
      </div>

      <GrievanceInbox initialItems={initialItems} />

      {!supabaseMode ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> {SUPPORT_DEMO_NOTE}
        </p>
      ) : null}
    </div>
  );
}
