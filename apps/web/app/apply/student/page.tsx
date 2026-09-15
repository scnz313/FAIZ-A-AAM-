"use client";

import { useEffect, useState } from "react";

import { ApplicantShell } from "@/components/layouts/ApplicantShell";
import ApplicationForm, { APPLICATION_STEPS } from "@/components/applicant/ApplicationForm";
import ProgressRail from "@/components/applicant/ProgressRail";
import Button from "@/components/ui/Button";
import { ErrorPanel, LoadingSkeleton } from "@/components/ui/AsyncStates";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import type { ApplicationStatus } from "@/modules/admissions/demo";
import { formatKolkata } from "@/modules/iot/domain";
import { admissionsService, type ApplicationRecord } from "@/modules/services/admissions";
import { clientAdapterMode } from "@/modules/services/adapter-client";

import styles from "./page.module.css";

const STATUS_TONE: Record<ApplicationStatus, StatusTone> = {
  Draft: "neutral",
  Submitted: "watch",
  "Under review": "watch",
  "Changes requested": "alert",
  Assessment: "watch",
  Offered: "good",
  Waitlisted: "watch",
  Declined: "neutral",
  Enrolled: "good",
  Withdrawn: "neutral",
};

type Mode = "deciding" | "new" | "edit";

/**
 * Student admission application. Signed-in applicants with saved records
 * choose between continuing a draft, tracking a submitted application, or
 * starting a new one; `?edit=REF` opens a specific application directly.
 */
export default function ApplyStudentPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [context, setContext] = useState({ grade: "", session: "" });
  const [mode, setMode] = useState<Mode>("deciding");
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [applications, setApplications] = useState<ApplicationRecord[] | null>(null);
  const [listError, setListError] = useState(false);

  function readApplications() {
    setListError(false);
    setApplications(null);
    admissionsService
      .listMyApplications()
      .then((list) => {
        setApplications(list);
        setMode(list.length > 0 ? "deciding" : "new");
      })
      .catch(() => setListError(true));
  }

  useEffect(() => {
    const editRef = new URLSearchParams(window.location.search).get("edit");
    if (editRef) {
      setEditingRef(editRef);
      setMode("edit");
      return;
    }
    if (clientAdapterMode() !== "supabase") {
      /* Demo keeps the single-form behavior; the list is a live-account flow. */
      setMode("new");
      return;
    }
    readApplications();
  }, []);

  function startNew() {
    window.history.replaceState(null, "", "/apply/student");
    setEditingRef(null);
    setMode("new");
  }

  function continueApplication(ref: string) {
    window.history.replaceState(null, "", `/apply/student?edit=${encodeURIComponent(ref)}`);
    setEditingRef(ref);
    setMode("edit");
  }

  if (mode === "deciding" || listError) {
    return (
      <ApplicantShell>
        <div className={styles.chooser}>
          <p className="section-label">Applicant area</p>
          <h1 className={styles.chooserTitle}>Your applications</h1>
          <p className={styles.chooserNote}>
            Continue a saved draft, track a submitted application, or start a new one. Each application keeps its own
            reference and history.
          </p>

          {listError ? (
            <ErrorPanel title="Your applications could not be loaded" note="The admissions service did not respond. Nothing was changed.">
              <Button variant="quiet" type="button" onClick={readApplications}>
                Try again
              </Button>
            </ErrorPanel>
          ) : applications === null ? (
            <LoadingSkeleton lines={5} label="Loading your applications" />
          ) : (
            <>
              <ul className={styles.appList}>
                {applications.map((application) => {
                  const editable = application.status === "Draft" || application.status === "Changes requested";
                  return (
                    <li key={application.ref} className={styles.appRow}>
                      <div className={styles.appMain}>
                        <p className={styles.appRef}>
                          <span className="num">{application.ref}</span>
                          <StatusBadge tone={STATUS_TONE[application.status]}>{application.status}</StatusBadge>
                        </p>
                        <p className={styles.appMeta}>
                          {application.studentName} · {application.grade} · {application.session} ·{" "}
                          {application.status === "Draft" ? "Started" : "Submitted"}{" "}
                          {formatKolkata(application.submittedAtIso, { format: "day" })}
                          {editable && (application.documents ?? []).length > 0
                            ? ` · ${(application.documents ?? []).length} uploaded document${(application.documents ?? []).length === 1 ? "" : "s"}`
                            : ""}
                        </p>
                      </div>
                      <div className={styles.appActions}>
                        {editable ? (
                          <Button variant="primary" type="button" onClick={() => continueApplication(application.ref)}>
                            Continue application
                          </Button>
                        ) : (
                          <Button variant="quiet" href={`/apply/student/${encodeURIComponent(application.ref)}/status`}>
                            View status
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className={styles.chooserActions}>
                <Button variant="quiet" type="button" onClick={startNew}>
                  Start a new application
                </Button>
              </div>
            </>
          )}
        </div>
      </ApplicantShell>
    );
  }

  return (
    <ApplicantShell>
      <div className={styles.wizard}>
        <aside className={styles.railCol}>
          <ProgressRail
            steps={APPLICATION_STEPS}
            current={currentStep}
            contextTitle={context.grade || "New application"}
            contextSubtitle={context.session || "Configured admission session"}
          />
        </aside>

        <div className={styles.formCol}>
          <ApplicationForm key={editingRef ?? "new"} onStepChange={setCurrentStep} onContextChange={setContext} />
        </div>
      </div>
    </ApplicantShell>
  );
}
