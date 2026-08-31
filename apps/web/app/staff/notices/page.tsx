import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService } from "@/modules/services/content";
import { dataAdapter } from "@/lib/supabase/env";
import { loadServerContent } from "@/lib/supabase/server-loaders";
import { NoticePublisher } from "@/components/staff/NoticePublisher";

import styles from "./page.module.css";

export default async function NoticesPage() {
  /* Every notice (published, draft, scheduled, expired, archived) from the
     content service; the publisher writes back through the same service. */
  const adapter = dataAdapter();
  const notices = adapter === "supabase" ? await loadServerContent("staff") : await contentService.listForStaff();

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Notices</p>
        <h1 className="workspace-title">Notices</h1>
        <p className="workspace-intro">Draft → In review → Approved → Scheduled or Published → Archived.</p>
      </header>

      <NoticePublisher notices={notices} />

      <p className={styles.note}>Approved publish notes and audiences stay locked through release; unpublishing archives the current item.</p>
      {adapter === "demo" ? (
        <p className="demo-note">
          <span className="demo-badge">Demo data</span> {CONTENT_DEMO_NOTE}
        </p>
      ) : null}
    </div>
  );
}
