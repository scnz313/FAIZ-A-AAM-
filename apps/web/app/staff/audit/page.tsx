import { AuditExplorer } from "@/components/staff/AuditExplorer";
import { auditService } from "@/modules/services/audit";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAudit } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export default async function AuditPage() {
  /* Safe events only — actor/action/target/outcome, no secrets — read
     through the audit service; the explorer renders and filters them. */
  const events = dataAdapter() === "supabase" ? await loadServerAudit() as Awaited<ReturnType<typeof auditService.listEvents>> : await auditService.listEvents();

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Audit</p>
        <h1 className="workspace-title">Audit</h1>
        <p className="workspace-intro">Read-only evidence of every meaningful action.</p>
      </header>

      <AuditExplorer events={events} />

      <p className={styles.note}>Audit events are append-only and cannot be edited or deleted.</p>
      <p className="demo-note">
        <span className="demo-badge">Demo data</span> Fictional audit trail — real events arrive with the backend.
      </p>
    </div>
  );
}
