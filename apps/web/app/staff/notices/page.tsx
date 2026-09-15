import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService } from "@/modules/services/content";
import { ErrorPanel } from "@/components/ui/AsyncStates";
import RetryButton from "@/components/ui/RetryButton";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerContent } from "@/lib/supabase/server-loaders";
import { NoticePublisher } from "@/components/staff/NoticePublisher";

import styles from "./page.module.css";

export default async function NoticesPage() {
  /* Every notice (published, draft, scheduled, expired, archived) from the
     content service; the publisher writes back through the same service. */
  const adapter = dataAdapter();
  let notices;
  try {
    notices = adapter === "supabase" ? await loadServerContent("staff") : await contentService.listForStaff();
  } catch {
    return (
      <div className={styles.page}>
        <div className="page-head">
          <div>
            <h1 className={styles.title}>Notices</h1>
            <p className="ph-sub">Draft → In review → Approved → Scheduled or Published → Archived.</p>
          </div>
        </div>
        <ErrorPanel
          title="Notices could not be loaded."
          note="No notice was changed. Try again."
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
          <h1 className={styles.title}>Notices</h1>
          <p className="ph-sub">Draft → In review → Approved → Scheduled or Published → Archived.</p>
        </div>
      </div>

      <NoticePublisher notices={notices} />

      <p className={styles.note}>Approved publish notes and audiences stay locked through release; unpublishing archives the current item. Archiving is terminal · nothing is hard-deleted, and every version stays in the audit trail.</p>
      {adapter === "demo" ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> {CONTENT_DEMO_NOTE}
        </p>
      ) : null}
    </div>
  );
}
