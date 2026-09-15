import type { Metadata } from "next";
import Link from "next/link";

import AuthFrame from "@/components/identity/AuthFrame";
import { getServerActor } from "@/lib/auth/actor";
import { DEFAULT_STAFF_PORTAL, portalPrefixForProfile } from "@/lib/auth/portal-routes";
import { dataAdapter } from "@/lib/supabase/env";
import { inferStaffProfile } from "@/modules/services/staff-profiles";

export const metadata: Metadata = {
  title: "Access denied",
  description:
    "This area requires a role your account does not have. Contact the school office if this is wrong.",
};

/**
 * Access-denied state — V14 AuthFrame + pay-state pattern.
 * Authorization is enforced server-side; this page previews the denied state.
 */
export default async function AccessDeniedPage() {
  const adapter = dataAdapter();
  const demo = adapter === "demo";
  const actor = adapter === "supabase" ? await getServerActor() : null;
  const hasStaffWorkspace = actor?.roles.some((role) => !["guardian", "student"].includes(role)) ?? false;
  const hasFamilyWorkspace = actor?.roles.includes("guardian") ?? false;
  const staffPortal = portalPrefixForProfile(inferStaffProfile(actor?.roles ?? [])) ?? DEFAULT_STAFF_PORTAL;
  return (
    <AuthFrame
      title="This page is not available to you"
      sub="Your account does not have access to this area. We cannot show whether the page exists."
    >
      <div className="pay-state">
        <div className="ps-ic bad">
          <span className="msym" aria-hidden="true">shield_person</span>
        </div>
        <h2>Access checked, entry refused</h2>
        <p>
          If you believe this is a mistake, contact the office. Guardians: make sure you opened the link for your linked child.
        </p>
        <div className="row" style={{ gap: 10, justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
          <Link className="btn btn-primary btn-sm" href="/sign-in">Sign in with another account</Link>
          <Link className="btn btn-ghost btn-sm" href="/portal/support">Contact support</Link>
        </div>
        {hasStaffWorkspace ? (
          <Link className="underline-link small" href={staffPortal} style={{ display: "inline-block", marginTop: 12 }}>
            Open staff portal →
          </Link>
        ) : null}
        {hasFamilyWorkspace ? (
          <Link className="underline-link small" href="/portal" style={{ display: "inline-block", marginTop: 8 }}>
            Open family portal →
          </Link>
        ) : null}
      </div>
      {demo ? (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 16 }}>
          <span className="demo-badge">UI demo</span>{" "}
          Authorization is previewed locally in this adapter.
        </p>
      ) : (
        <p className="tiny muted" style={{ textAlign: "center", marginTop: 16 }}>
          Access was denied by the current account, role, or record scope. No protected record was disclosed.
        </p>
      )}
    </AuthFrame>
  );
}
