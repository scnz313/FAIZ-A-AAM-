import { AuditExplorer } from "@/components/staff/AuditExplorer";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import RetryButton from "@/components/ui/RetryButton";
import { auditService } from "@/modules/services/audit";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerAuditPage } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export default async function AuditPage() {
  /* Safe events only — actor/action/target/outcome, no secrets — read
     through the audit service; the explorer renders and filters them. */
  const supabaseMode = dataAdapter() === "supabase";
  let events;
  let nextCursor: string | null = null;
  try {
    if (supabaseMode) {
      const page = await loadServerAuditPage();
      events = page.events;
      nextCursor = page.nextCursor;
    } else {
      events = await auditService.listEvents();
    }
  } catch {
    return (
      <div className={styles.page}>
        <div className="page-head">
          <div>
            <h1 className={styles.title}>Audit</h1>
            <p className="ph-sub">Read-only evidence of every meaningful action.</p>
          </div>
        </div>
        <ErrorPanel
          title="Audit events could not be loaded."
          note="The audit trail itself is unaffected. Try again."
        >
          <RetryButton />
        </ErrorPanel>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <h1 className={styles.title}>Audit</h1>
          <p className="ph-sub">Read-only evidence of every meaningful action.</p>
        </div>
      </div>

      <AuditExplorer events={events} initialCursor={nextCursor} paged={supabaseMode} />

      <div className="callout">
        <span className="msym" aria-hidden="true">lock</span>
        <span className="small">Audit events are append-only and cannot be edited or deleted.</span>
      </div>
      {!supabaseMode ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> Fictional audit trail · real events arrive with the backend.
        </p>
      ) : null}
    </div>
  );
}
