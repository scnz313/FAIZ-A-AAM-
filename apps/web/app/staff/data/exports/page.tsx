"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import Button from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useStaffContext } from "@/components/staff/StaffContextProvider";
import { canAnyRole } from "@/modules/services/staff-profiles";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { adapterCall } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

type ExportRow = {
  requestId: string;
  reference: string;
  domain: string;
  state: string;
  format: string;
  rowCount: number | null;
  purpose: string;
  expiresAt: string | null;
  createdAt: string;
};

const DOMAINS = [
  "students",
  "guardians",
  "guardian_student_links",
  "enrollments",
  "admissions",
  "invoices",
  "results",
] as const;

/**
 * Protected data exports (Administrator): purpose-bound, column-allowlisted,
 * formula-safe, private, expiring, and audited. Artifacts are private
 * generated documents with short signed delivery — never raw dumps.
 */
export default function DataExportsWorkspace() {
  const { summary } = useStaffContext();
  const canManage = canAnyRole(summary?.roles ?? [], "users.manage");
  const supabaseMode = clientAdapterMode() === "supabase";
  const [rows, setRows] = useState<ExportRow[] | null>(null);
  const [domain, setDomain] = useState<(typeof DOMAINS)[number]>("students");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ purpose?: string; reason?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!supabaseMode) {
      setRows([]);
      return;
    }
    try {
      const result = await adapterCall<ExportRow[]>("dataExports.list", {});
      setRows(result.ok ? result.value : []);
    } catch {
      setRows([]);
    }
  }, [supabaseMode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: { purpose?: string; reason?: string } = {
      purpose: purpose.trim().length >= 3 ? undefined : "A stated purpose is required.",
      reason: reason.trim().length >= 3 ? undefined : "A recorded reason is required.",
    };
    setErrors(next);
    if (Object.values(next).some((value) => value !== undefined)) return;
    if (format === "xlsx") {
      setErrors({ form: "XLSX generation is not enabled in this environment — use CSV." });
      return;
    }
    setBusy(true);
    try {
      const result = await adapterCall<{ reference: string }>("dataExports.request", {
        domain,
        filters: {},
        columns: [],
        format,
        purpose: purpose.trim(),
        reason: reason.trim(),
      });
      if (!result.ok) throw new Error(result.errors[0]?.message ?? "The export request failed.");
      setNotice(`Export ${result.value.reference} requested — the artifact is generated privately and expires in 24 hours.`);
      setPurpose("");
      setReason("");
      await refresh();
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "The export request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={`workspace-header ${styles.header}`}>
        <p className="eyebrow">Administrator · Data</p>
        <h1 className="workspace-title">Data exports</h1>
        <p className="workspace-intro">
          Purpose-bound, filtered exports with formula-safe output, private storage, short expiry, and full audit.
        </p>
      </header>

      {!supabaseMode ? <p className="demo-badge">Demo data</p> : null}
      {notice ? <p className={styles.liveNote} role="status" aria-live="polite">{notice}</p> : null}

      <form className={styles.panel} onSubmit={handleRequest} noValidate>
        <div className="field">
          <label htmlFor="export-domain">Domain</label>
          <select id="export-domain" className="select" value={domain}
            onChange={(event) => setDomain(event.target.value as (typeof DOMAINS)[number])}>
            {DOMAINS.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="export-format">Format</label>
          <select id="export-format" className="select" value={format}
            onChange={(event) => setFormat(event.target.value as "csv" | "xlsx")}>
            <option value="csv">CSV (formula-safe)</option>
            <option value="xlsx">XLSX (blocked pending parser approval)</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="export-purpose">Purpose (stated and audited)</label>
          <input id="export-purpose" className="input" type="text" value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            aria-invalid={errors.purpose !== undefined}
            aria-describedby={errors.purpose ? "export-purpose-error" : undefined} />
          {errors.purpose ? <p className="field-error" id="export-purpose-error">{errors.purpose}</p> : null}
        </div>
        <div className="field">
          <label htmlFor="export-reason">Reason (recorded in audit trail)</label>
          <input id="export-reason" className="input" type="text" value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={errors.reason !== undefined}
            aria-describedby={errors.reason ? "export-reason-error" : undefined} />
          {errors.reason ? <p className="field-error" id="export-reason-error">{errors.reason}</p> : null}
        </div>
        {errors.form ? <p className={styles.errorNote} role="alert">{errors.form}</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" type="submit" disabled={busy || !canManage}>
            {busy ? "Requesting…" : "Request export"}
          </Button>
        </div>
      </form>

      <section aria-labelledby="exports-heading">
        <h2 id="exports-heading" className="section-label">Export requests</h2>
        {rows === null ? (
          <p className={styles.loading} role="status">Loading export requests…</p>
        ) : rows.length === 0 ? (
          <div className="workspace-state">
            <p className="workspace-state-title">No export requests</p>
            <p className="workspace-state-note">Request a filtered export above; artifacts expire after 24 hours.</p>
          </div>
        ) : (
          <div className="table--scroll">
            <table className={`table ${styles.table}`}>
              <caption className="sr-only">Export requests with state and expiry</caption>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Domain</th>
                  <th scope="col">State</th>
                  <th scope="col" className="num">Rows</th>
                  <th scope="col">Expires</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.requestId}>
                    <td className="num">{row.reference}</td>
                    <td>{row.domain.replace(/_/g, " ")}</td>
                    <td>
                      <StatusBadge tone={row.state === "ready" ? "good" : row.state === "failed" || row.state === "expired" ? "alert" : "watch"}>
                        {row.state}
                      </StatusBadge>
                    </td>
                    <td className="num">{row.rowCount ?? "—"}</td>
                    <td>{row.expiresAt !== null ? new Date(row.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className={styles.note}>
        Exports are column-allowlisted and formula-neutralized; internal identifiers, auth fields, invitation tokens,
        and medical/support detail are omitted by default. Artifacts are private documents with short signed delivery.
      </p>
    </div>
  );
}
