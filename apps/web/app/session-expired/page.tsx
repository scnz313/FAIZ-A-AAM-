import type { Metadata } from "next";
import Link from "next/link";

import AuthFrame from "@/components/identity/AuthFrame";
import { dataAdapter } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Session expired",
  description: "Your Faiz E Aam session ended after inactivity. Sign in again to continue.",
};

/**
 * Session-expired state — V14 AuthFrame + pay-state pattern.
 * Sessions are not real yet in demo mode; this page previews the state.
 */
export default function SessionExpiredPage() {
  const demo = dataAdapter() === "demo";
  return (
    <AuthFrame
      title="Your session ended"
      sub="For the safety of student records, sessions close after a period of inactivity."
    >
      <div className="pay-state">
        <div className="ps-ic wait">
          <span className="msym" aria-hidden="true">time_auto</span>
        </div>
        <h2>Nothing was lost</h2>
        <p>Unsaved drafts stay saved. Sign in again to pick up where you left off.</p>
        <Link className="btn btn-primary" href="/sign-in" style={{ marginTop: 18 }}>
          Sign in again
        </Link>
      </div>
      {demo ? (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 16 }}>
          <span className="demo-badge">UI demo</span>{" "}
          This adapter previews the session-expiry state.
        </p>
      ) : (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 16 }}>
          Your previous session can no longer access protected records. Sign in again to continue safely.
        </p>
      )}
    </AuthFrame>
  );
}
