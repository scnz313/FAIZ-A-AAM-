"use client";

import { useState } from "react";

import Button from "@/components/ui/Button";
import { formatINR } from "@/modules/finance/demo";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./AcceptSeat.module.css";

type AcceptSeatProps = {
  grade: string;
  session: string;
  /** Whether the record already shows the seat as accepted (service state). */
  accepted: boolean;
  /** Admission amount that falls due once the seat is accepted (integer paise). */
  admissionFeePaise: number;
  /** Last date the seat is held, shown with the fee in the confirm panel. */
  acceptByIso: string;
  /** True while the offer response is being recorded by the service. */
  busy: boolean;
  /** Recoverable error from the last response attempt. */
  error: string | null;
  /** Records the response through the admissions service. */
  onRespond: (accepted: boolean, note: string) => void;
};

type ConfirmKind = "accept" | "decline" | null;

/**
 * Offer-response island on the status page. Both accept and decline go
 * through a small inline confirmation (with an optional note); the record
 * comes back from the admissions service, so the accepted state and the
 * fee step that follows are driven by persisted demo state, not a local
 * click. Demo-only — the backend will record responses server-side.
 */
export default function AcceptSeat({
  grade,
  session,
  accepted,
  admissionFeePaise,
  acceptByIso,
  busy,
  error,
  onRespond,
}: AcceptSeatProps) {
  const [confirm, setConfirm] = useState<ConfirmKind>(null);
  const [note, setNote] = useState("");

  if (accepted) {
    return (
      <div className={styles.acceptedBlock} role="status">
        <p className={styles.acceptedTitle}>Seat accepted</p>
        <p className={styles.acceptedNote}>
          You have accepted the offer for {grade}, session {session}. The admission amount is now due below.
          Enrollment completes once it is recorded.
        </p>
      </div>
    );
  }

  return (
    <div>
      {confirm === null ? (
        <>
          <div className={styles.offerButtons}>
            <Button variant="primary" onClick={() => setConfirm("accept")} disabled={busy}>
              Accept seat
            </Button>
            <Button variant="quiet" onClick={() => setConfirm("decline")} disabled={busy}>
              Decline offer
            </Button>
          </div>
          <p className={styles.acceptHint}>
            Accepting does not confirm enrollment · the admission amount is due after acceptance.
          </p>
        </>
      ) : (
        <div className={styles.confirmBlock} role="group" aria-label={confirm === "accept" ? "Confirm acceptance" : "Confirm decline"}>
          <p className={styles.confirmTitle}>
            {confirm === "accept"
              ? `Confirm acceptance for ${grade}, ${session}?`
              : `Decline the offer for ${grade}, ${session}?`}
          </p>
          {confirm === "decline" ? (
            <p className={styles.declineHint}>Declining releases the seat to the next candidate. This cannot be undone.</p>
          ) : (
            <p className={styles.declineHint}>
              {admissionFeePaise > 0 ? (
                <>
                  On confirmation, the admission amount of{" "}
                  <strong className="num">{formatINR(admissionFeePaise)}</strong> falls due on your fee ledger ·
                  payable by {formatKolkata(acceptByIso, { format: "day" })}. Enrollment completes only once it is
                  recorded.
                </>
              ) : (
                <>
                  On confirmation, the admission amount confirmed by the school office falls due on your fee ledger ·
                  payable by {formatKolkata(acceptByIso, { format: "day" })}. Enrollment completes only once it is
                  recorded.
                </>
              )}
            </p>
          )}
          <label className={styles.noteLabel} htmlFor="offer-note">
            Note <span className={styles.noteOptional}>(optional)</span>
          </label>
          <input
            id="offer-note"
            className="input"
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className={styles.confirmActions}>
            <Button
              variant={confirm === "accept" ? "primary" : "danger"}
              disabled={busy}
              onClick={() => onRespond(confirm === "accept", note.trim())}
            >
              {busy ? "Confirming…" : confirm === "accept" ? "Confirm acceptance" : "Confirm decline"}
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => { setConfirm(null); setNote(""); }}>
              Cancel
            </Button>
          </div>
          {error ? (
            <p className={styles.confirmError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
