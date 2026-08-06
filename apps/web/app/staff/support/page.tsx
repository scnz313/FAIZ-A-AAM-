import { GrievanceInbox } from "@/components/staff/GrievanceInbox";
import { SUPPORT_DEMO_NOTE } from "@/modules/support/demo";

import styles from "./page.module.css";

export default function SupportPage() {
  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Staff · Support</p>
        <h1 className="workspace-title">Grievances</h1>
        <p className="workspace-intro">Parent and applicant concerns, in order of arrival.</p>
      </header>

      <GrievanceInbox />

      <p className="demo-note">
        <span className="demo-badge">Demo data</span> {SUPPORT_DEMO_NOTE}
      </p>
    </div>
  );
}
