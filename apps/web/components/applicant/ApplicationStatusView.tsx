"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import Button from "@/components/ui/Button";
import StatusTimeline from "@/components/applicant/StatusTimeline";
import AcceptSeat from "@/components/applicant/AcceptSeat";
import AdmissionFeeStep from "@/components/applicant/AdmissionFeeStep";
import { ADMISSIONS_DEMO_NOTE } from "@/modules/admissions/demo";
import { admissionsService, type ApplicationRecord, type ApplicationStatus } from "@/modules/services/admissions";
import { formatINR } from "@/modules/finance/demo";
import { formatKolkata } from "@/modules/iot/domain";

import styles from "./ApplicationStatusView.module.css";

function statusTone(status: ApplicationStatus): StatusTone {
  switch (status) {
    case "Offered":
    case "Enrolled":
      return "good";
    case "Assessment":
    case "Under review":
    case "Waitlisted":
      return "watch";
    case "Changes requested":
    case "Declined":
      return "alert";
    default:
      return "neutral";
  }
}

/** Statuses where an applicant may still withdraw (policy permitting). */
const WITHDRAWABLE: readonly ApplicationStatus[] = [
  "Submitted",
  "Under review",
  "Changes requested",
  "Assessment",
  "Waitlisted",
];

/**
 * Shared application status view, rendered by both /apply/student/[ref]
 * and /apply/student/[ref]/status. The record comes from the admissions
 * service on mount: fixture references and session-submitted applications
 * show the real record (details, timeline, offer panels); unknown
 * references show the honest not-in-records state. Offer accept/decline
 * responses and requested-change edits are recorded through the service.
 */
export default function ApplicationStatusView({ applicationRef, initial }: { applicationRef: string; initial?: ApplicationRecord | null }) {
  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<ApplicationRecord | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    admissionsService
      .getApplication(applicationRef)
      .then((application) => {
        setRecord(application);
        setLoading(false);
      })
      .catch(() => {
        setLoadError("We could not load this application right now. Please try again.");
        setLoading(false);
      });
  }, [applicationRef]);

  useEffect(() => {
    if (initial !== undefined) {
      setLoading(false);
      return;
    }
    load();
  }, [load, initial]);

  async function handleOfferResponse(accepted: boolean, note: string) {
    if (!record || responding) return;
    setResponding(true);
    setResponseError(null);
    try {
      const updated = await admissionsService.respondToOffer(record.ref, accepted, record.parentName, note);
      setRecord(updated);
    } catch {
      setResponseError(
        accepted
          ? "We could not record the acceptance. Please try again."
          : "We could not record the decline. Please try again.",
      );
    } finally {
      setResponding(false);
    }
  }

  if (loading) {
    return (
      <div className={styles.shell}>
        <p className={styles.loadingLine} aria-live="polite">
          Checking the application record…
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.shell}>
        <p className={styles.errorLine} role="alert">
          {loadError}
        </p>
        <Button variant="quiet" onClick={load}>
          Try again
        </Button>
      </div>
    );
  }

  if (!record) {
    return (
      <div className={styles.shell}>
        <header className={styles.head}>
          <p className="eyebrow">Application · {applicationRef}</p>
          <h1 className={styles.headTitle}>Reference not found</h1>
          <p className={styles.headLine}>
            Application {applicationRef} is not in the school&rsquo;s records.
          </p>
          <div className={styles.badgeRow}>
            <StatusBadge tone="neutral">Not found</StatusBadge>
            <span className="demo-badge">{ADMISSIONS_DEMO_NOTE}</span>
          </div>
        </header>

        <div className={styles.grid}>
          <section className={styles.section} aria-labelledby="notfound-heading">
            <h2 className={styles.sectionTitle} id="notfound-heading">
              What you can do
            </h2>
            <ol className={styles.nextList}>
              <li>Check the reference number against your acknowledgement — applications are tracked by reference only.</li>
              <li>If you just submitted, the acknowledgement link works for this browser session.</li>
              <li>If you believe this is an error, contact the school office with the reference.</li>
            </ol>
          </section>

          <aside className={styles.side} aria-label="Next steps">
            <section className={styles.panelBlock}>
              <p className="section-label">Keep this reference safe</p>
              <p className={styles.sideNote}>
                Every enquiry about an application uses its reference. The school never asks for documents or
                payments through a public link.
              </p>
            </section>
            <p className={styles.backLink}>
              <a className="link-arrow" href="/admissions">
                Back to admissions →
              </a>
            </p>
          </aside>
        </div>
      </div>
    );
  }

  const requestNote = [...record.timeline].reverse().find((e) => e.status === "Changes requested")?.note;
  const canWithdraw = WITHDRAWABLE.includes(record.status);

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <p className="eyebrow">Application · {record.ref}</p>
        <h1 className={styles.headTitle}>{record.studentName}</h1>
        <p className={styles.headLine}>
          {record.grade} · Session {record.session} · Submitted{" "}
          {formatKolkata(record.submittedAtIso, { format: "short" })}
        </p>
        <div className={styles.badgeRow}>
          <StatusBadge tone={statusTone(record.status)}>{record.status}</StatusBadge>
          <span className="demo-badge">{ADMISSIONS_DEMO_NOTE}</span>
        </div>
      </header>

      {record.status === "Changes requested" ? (
        <section className={styles.changePanel} aria-labelledby="change-heading">
          <p className="section-label">Action needed from you</p>
          <h2 className={styles.changeTitle} id="change-heading">
            Changes requested
          </h2>
          <p className={styles.changeNote}>{requestNote ?? "The admissions office has asked for changes."}</p>
          <div className={styles.changeActions}>
            <Button href={`/apply/student?edit=${record.ref}`} variant="primary">
              Edit application →
            </Button>
          </div>
        </section>
      ) : null}
      {record.duplicateReview ? (
        <section className={styles.changePanel} aria-labelledby="duplicate-review-heading">
          <p className="section-label">School review required</p>
          <h2 className={styles.changeTitle} id="duplicate-review-heading">Identity review in progress</h2>
          <p className={styles.changeNote}>The school found a possible existing student match and will verify identity evidence before completing enrollment. Your application is not merged on name alone.</p>
        </section>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.section} aria-labelledby="timeline-heading">
          <h2 className={styles.sectionTitle} id="timeline-heading">
            Application timeline
          </h2>
          <StatusTimeline events={record.timeline} />
        </section>

        <aside className={styles.side} aria-label="Application details">
          <section className={styles.panelBlock}>
            <p className="section-label">Applicant</p>
            <dl className={styles.detailList}>
              <div className={styles.detailRow}>
                <dt>Student</dt>
                <dd>{record.studentName}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Parent / guardian</dt>
                <dd>{record.parentName}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Contact</dt>
                <dd>{record.contact}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt>Reference</dt>
                <dd>{record.ref}</dd>
              </div>
            </dl>
          </section>

          {record.status === "Offered" && record.offer && !record.offer.declined ? (
            <section className={styles.offerPanel} aria-labelledby="offer-heading">
              <p className="section-label">Offer</p>
              <h2 className={styles.offerTitle} id="offer-heading">
                Seat offered — {record.offer.grade}, {record.offer.session}
              </h2>
              <dl className={styles.detailList}>
                <div className={styles.detailRow}>
                  <dt>Seat</dt>
                  <dd>
                    {record.offer.grade} · {record.offer.session}
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Accept by</dt>
                  <dd>{formatKolkata(record.offer.acceptByIso, { format: "full" })}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt>Admission fee</dt>
                  <dd className={styles.fee}>{formatINR(record.offer.admissionFeePaise)}</dd>
                </div>
              </dl>
              <div className={styles.offerActions}>
                <AcceptSeat
                  grade={record.offer.grade}
                  session={record.offer.session}
                  accepted={record.offer.accepted}
                  admissionFeePaise={record.offer.admissionFeePaise}
                  acceptByIso={record.offer.acceptByIso}
                  busy={responding}
                  error={responseError}
                  onRespond={handleOfferResponse}
                />
              </div>
              <p className={styles.sideNote}>
                Payment comes after acceptance — the school never collects the admission amount before the seat is
                confirmed.
              </p>
            </section>
          ) : null}

          {record.status === "Declined" ? (
            <section className={styles.declinedPanel} aria-labelledby="declined-heading">
              <p className="section-label">Offer response</p>
              <h2 className={styles.declinedTitle} id="declined-heading">
                Offer declined
              </h2>
              <p className={styles.declinedNote}>
                The seat has been released to the next candidate. This application is now closed.
              </p>
              <ol className={styles.nextList}>
                <li>The seat moves to the next eligible candidate.</li>
                <li>Your application record stays on file for this admission cycle.</li>
                <li>A future session requires a fresh application.</li>
              </ol>
            </section>
          ) : null}

          {record.status === "Enrolled" && record.studentRef ? (
            <section className={styles.enrolledPanel} aria-labelledby="enrolled-heading" role="status">
              <p className="section-label">Enrollment</p>
              <h2 className={styles.enrolledTitle} id="enrolled-heading">
                Enrollment complete
              </h2>
              <dl className={styles.detailList}>
                <div className={styles.detailRow}>
                  <dt>Permanent student reference</dt>
                  <dd className="num">{record.studentRef}</dd>
                </div>
                {record.enrollmentRef ? (
                  <div className={styles.detailRow}>
                    <dt>Enrollment reference</dt>
                    <dd className="num">{record.enrollmentRef}</dd>
                  </div>
                ) : null}
              </dl>
              <p className={styles.sideNote}>
                {record.linkRef
                  ? "The child is linked to the guardian's family portal — sign in to see fees, results, timetable, and notices under the linked child."
                  : "The school will invite the guardian to link the child to a family portal account."}
              </p>
              <div className={styles.offerActions}>
                <Button href="/portal" variant="primary">
                  Open family portal →
                </Button>
              </div>
            </section>
          ) : null}

          {record.offer?.accepted && record.status !== "Enrolled" && record.offer.admissionInvoiceRef ? (
            <AdmissionFeeStep
              applicationRef={record.ref}
              invoiceRef={record.offer.admissionInvoiceRef}
              acceptByIso={record.offer.acceptByIso}
            />
          ) : null}

          {canWithdraw ? (
            <section className={styles.withdrawBlock} aria-label="Withdrawal">
              <Button variant="quiet" disabled>
                Withdraw application
              </Button>
              <p className={styles.sideNote}>
                Withdrawal policy is pending a school decision — this control is not yet available.
              </p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
