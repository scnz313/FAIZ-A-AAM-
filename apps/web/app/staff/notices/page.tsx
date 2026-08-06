import { CONTENT_DEMO_NOTE } from "@/modules/content/demo";
import { contentService } from "@/modules/services/content";
import { NoticePublisher } from "@/components/staff/NoticePublisher";

import styles from "./page.module.css";

export default async function NoticesPage() {
  /* Every notice (published, draft, scheduled, expired) from the content
     service; the publisher writes back through the same service. */
  const notices = await contentService.listForStaff();

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Notices</p>
        <h1 className="workspace-title">Notices</h1>
        <p className="workspace-intro">Draft → Scheduled → Published; expired notices archive automatically.</p>
      </header>

      <NoticePublisher notices={notices} />

      <p className={styles.note}>Scheduled publishing and version history arrive with the CMS backend.</p>
      <p className="demo-note">
        <span className="demo-badge">Demo data</span> {CONTENT_DEMO_NOTE}
      </p>
    </div>
  );
}
