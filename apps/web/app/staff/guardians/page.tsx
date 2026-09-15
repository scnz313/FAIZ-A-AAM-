import type { Metadata } from "next";
import Link from "next/link";

import { canonicalStaffUrl } from "@/lib/auth/portal-routes";
import { loadServerProfileCode } from "@/lib/supabase/server-loaders";

import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Guardians · Staff",
};

/**
 * Guardians planned-workspace placeholder (F22) — honest by design.
 * Guardian activation and campaign operations belong to the integration
 * backlog; this route resolves instead of 404ing, names what will live
 * here, and points at the queues that work today. No control here implies
 * a working operation.
 */
export default async function GuardiansPage() {
  const profileCode = await loadServerProfileCode();
  return (
    <div className={styles.page}>
      <div className="page-head">
        <div>
          <p className="eyebrow">Administrator · Guardians</p>
          <h1 className={styles.title}>Guardians</h1>
          <p className="ph-sub">Planned workspace · activation campaigns and link health, not yet operational.</p>
        </div>
      </div>

      <div className="panel">
        <div className="pn-head">
          <h2>What this workspace will do</h2>
        </div>
        <div className="pn-body">
          <div className="facts-ledger">
            <div className="fl-row">
              <span className="k">Activation campaigns</span>
              <span className="v">Planned</span>
            </div>
            <div className="fl-row">
              <span className="k">Link health</span>
              <span className="v">Planned</span>
            </div>
            <div className="fl-row">
              <span className="k">Contact-change review</span>
              <span className="v">Planned</span>
            </div>
          </div>
        </div>
      </div>

      <div className="callout">
        <span className="msym" aria-hidden="true" style={{ fontSize: 20 }}>
          info
        </span>
        <span className="small">
          Guardian onboarding today runs through Guardian links verification and student/guardian imports. Nothing on
          this page sends invitations or changes access.
        </span>
      </div>

      <div className={styles.actions}>
        <Link prefetch={false} className="btn btn-ghost btn-sm" href={canonicalStaffUrl(profileCode, "/link-requests")}>
          Open Guardian links →
        </Link>
        <Link prefetch={false} className="btn btn-ghost btn-sm" href={canonicalStaffUrl(profileCode, "/data/imports")}>
          Open imports →
        </Link>
      </div>
    </div>
  );
}
