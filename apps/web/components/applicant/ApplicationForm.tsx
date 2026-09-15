"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import type { ProgressRailStep } from "@/components/applicant/ProgressRail";
import { formatKolkata } from "@/modules/iot/domain";
import { admissionsService, type ApplicationRecord } from "@/modules/services/admissions";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { sessionKey } from "@/modules/services/session";
import { DEMO_ADMISSION_CONFIGURATION, schoolConfigService, type AdmissionConfiguration, type AdmissionDocumentRequirement } from "@/modules/services/school-config";
import { getDocumentUploadStatus, uploadDocumentFile } from "@/modules/services/document-upload";

import styles from "./ApplicationForm.module.css";

export const APPLICATION_STEPS = [
  { num: "01", label: "Academic", hint: "Session & grade" },
  { num: "02", label: "Student details", hint: "Identity" },
  { num: "03", label: "Guardian details", hint: "Parent or guardian" },
  { num: "04", label: "Address", hint: "Residential" },
  { num: "05", label: "Prior school", hint: "Previous education" },
  { num: "06", label: "Medical & accommodation", hint: "Sensitive" },
  { num: "07", label: "Documents", hint: "4 required" },
  { num: "08", label: "Review & declaration", hint: "Consent" },
] as const satisfies readonly ProgressRailStep[];

const STEP_INTRO: readonly string[] = [
  "Tell us the session and the class you are applying for. Grade capacity follows the school's confirmed admission policy.",
  "The student's full legal name as it appears on the birth certificate, and basic identity details.",
  "The parent or guardian who will be the primary contact for this application.",
  "The residential address where the family can be reached.",
  "The school the student currently attends, or last attended.",
  "Only what the admissions team needs in order to plan support. This section is sensitive and visible to fewer staff than the rest of the application.",
  "Attach the required documents. Each requirement follows the school configuration for this application window.",
  "Check every section, then read and accept the declaration to submit.",
];

/** Tab-session draft key; must match ResumeDraft's autosave key. */
const STORAGE_KEY = sessionKey("application-draft");

type DocKey = string;
type UploadState = "uploading" | "checking" | "pending" | "ready" | "quarantined" | "failed";

function documentAccept(requirement: AdmissionDocumentRequirement): string {
  return requirement.allowedMimeTypes.map((mime) => mime === "application/pdf" ? ".pdf" : mime === "image/jpeg" ? ".jpg,.jpeg" : mime === "image/png" ? ".png" : mime).join(",");
}

function documentHelp(requirement: AdmissionDocumentRequirement): string {
  const types = requirement.allowedMimeTypes.map((mime) => mime === "application/pdf" ? "PDF" : mime === "image/jpeg" ? "JPG" : mime === "image/png" ? "PNG" : mime).join(", ");
  return `${types} · up to ${Math.max(1, Math.round(requirement.maxBytes / (1024 * 1024)))} MB`;
}

const CONDITIONS: readonly { key: string; label: string }[] = [
  { key: "asthma", label: "Asthma or a respiratory condition" },
  { key: "allergies", label: "Allergies · food, medicine, or environmental" },
  { key: "diabetes", label: "Diabetes" },
  { key: "epilepsy", label: "Epilepsy or seizure disorder" },
  { key: "vision", label: "Vision or hearing difficulty" },
  { key: "mobility", label: "Mobility or physical support needs" },
  { key: "none", label: "None · nothing to declare" },
];

const CONDITION_LABELS: Record<string, string> = Object.fromEntries(CONDITIONS.map((c) => [c.key, c.label]));

const ERROR_LABELS: Record<string, string> = {
  session: "Academic session",
  grade: "Class",
  studentName: "Full name",
  dob: "Date of birth",
  gender: "Gender",
  placeOfBirth: "Place of birth",
  guardianName: "Parent/guardian name",
  relation: "Relationship",
  phone: "Phone number",
  email: "Email address",
  houseStreet: "House & street",
  villageTown: "Village / town",
  district: "District",
  pin: "PIN code",
  priorSchoolName: "Prior school name",
  lastClassAttended: "Class last attended",
  "doc-birth": "Birth certificate",
  "doc-photo": "Student photograph",
  "doc-reportCard": "Previous report card",
  "doc-addressProof": "Address proof",
  consent: "Declaration",
};

type Draft = {
  session: string;
  grade: string;
  studentName: string;
  dob: string;
  gender: string;
  placeOfBirth: string;
  guardianName: string;
  relation: string;
  phone: string;
  email: string;
  occupation: string;
  houseStreet: string;
  villageTown: string;
  district: string;
  pin: string;
  priorSchoolName: string;
  lastClassAttended: string;
  leavingCertificate: string;
  conditions: string[];
  documents: Record<string, string>;
  consent: boolean;
  savedAtIso?: string;
};

type ServerSaveResult = { savedAtIso: string; draftRef?: string };
type ServerSaveWaiter = { resolve: (result: ServerSaveResult) => void; reject: (error: unknown) => void };

const TEXT_FIELDS = [
  "session",
  "grade",
  "studentName",
  "dob",
  "gender",
  "placeOfBirth",
  "guardianName",
  "relation",
  "phone",
  "email",
  "occupation",
  "houseStreet",
  "villageTown",
  "district",
  "pin",
  "priorSchoolName",
  "lastClassAttended",
  "leavingCertificate",
] as const satisfies readonly (keyof Draft)[];

function emptyDraft(): Draft {
  return {
    session: "",
    grade: "",
    studentName: "",
    dob: "",
    gender: "",
    placeOfBirth: "",
    guardianName: "",
    relation: "",
    phone: "",
    email: "",
    occupation: "",
    houseStreet: "",
    villageTown: "",
    district: "",
    pin: "",
    priorSchoolName: "",
    lastClassAttended: "",
    leavingCertificate: "",
    conditions: [],
    documents: {},
    consent: false,
  };
}

/** Configuration labels ("2026–27", "Class 8") and draft values ("2026-27")
 * must compare across dash styles and spacing. */
function normalizedConfigurationLabel(value: string): string {
  return value.replace(/[–—]/g, "-").replace(/\s+/g, "").toLowerCase();
}

/**
 * Document requirements belong to the admission window for the chosen grade
 * and session. Without this scope, every window's identical requirement codes
 * render as duplicate file inputs. Exported for the scoping regression test.
 */
export function selectAdmissionWindowRequirements(
  configuration: AdmissionConfiguration | null,
  grade: string,
  session: string,
): AdmissionDocumentRequirement[] {
  if (configuration === null || session.trim() === "" || grade.trim() === "") return [];
  const year = configuration.academicYears.find((candidate) => normalizedConfigurationLabel(candidate.label) === normalizedConfigurationLabel(session));
  const selectedGrade = configuration.grades.find((candidate) => normalizedConfigurationLabel(candidate.label) === normalizedConfigurationLabel(grade));
  if (year === undefined || selectedGrade === undefined) return [];
  const window = configuration.windows.find(
    (candidate) => candidate.academicYearId === year.id
      && candidate.gradeId === selectedGrade.id
      && (candidate.status === "open" || candidate.status === "planned"),
  );
  if (window === undefined) return [];
  return configuration.documentRequirements.filter(
    (requirement) => requirement.status === "active" && requirement.windowId === window.id,
  );
}

/** Keep only known fields when restoring a draft, so corrupted or foreign data never loads. */
function sanitizeDraft(raw: unknown): Draft {
  const draft = emptyDraft();
  if (!raw || typeof raw !== "object") return draft;
  const record = raw as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    if (typeof record[key] === "string") draft[key] = record[key] as string;
  }
  if (Array.isArray(record.conditions)) {
    const known = new Set(CONDITIONS.map((c) => c.key));
    draft.conditions = record.conditions.filter((c): c is string => typeof c === "string" && known.has(c));
  }
  if (record.documents && typeof record.documents === "object") {
    const docs = record.documents as Record<string, unknown>;
    for (const [key, value] of Object.entries(docs)) {
      if (typeof value === "string") draft.documents[key] = value;
    }
  }
  if (typeof record.consent === "boolean") draft.consent = record.consent;
  if (typeof record.savedAtIso === "string") draft.savedAtIso = record.savedAtIso;
  return draft;
}

/**
 * Fields safe to persist in the tab-session draft. Identity (dob, gender,
 * place of birth), medical/accommodation (conditions), address, contact
 * (phone, email), and document upload details are sensitive and stay in
 * component state (memory) only — they are never written to browser
 * storage, so a reload re-asks for them.
 */
const NON_SENSITIVE_FIELDS = [
  "session",
  "grade",
  "studentName",
  "guardianName",
  "relation",
  "occupation",
  "priorSchoolName",
  "lastClassAttended",
  "leavingCertificate",
] as const satisfies readonly (keyof Draft)[];

/** Shape persisted by the tab-session draft: non-sensitive fields plus
 * section progress and the save timestamp. */
type TabDraft = {
  session: string;
  grade: string;
  studentName: string;
  guardianName: string;
  relation: string;
  occupation: string;
  priorSchoolName: string;
  lastClassAttended: string;
  leavingCertificate: string;
  step: number;
  savedAtIso?: string;
};

function toTabDraft(draft: Draft, step: number, savedAtIso: string): TabDraft {
  return {
    session: draft.session,
    grade: draft.grade,
    studentName: draft.studentName,
    guardianName: draft.guardianName,
    relation: draft.relation,
    occupation: draft.occupation,
    priorSchoolName: draft.priorSchoolName,
    lastClassAttended: draft.lastClassAttended,
    leavingCertificate: draft.leavingCertificate,
    step,
    savedAtIso,
  };
}

/** Restore the tab draft: only non-sensitive fields merge back into state;
 * sensitive fields start empty so the applicant re-enters them. */
function restoreTabDraft(raw: unknown): { draft: Draft; step: number; savedAtIso?: string } {
  const draft = emptyDraft();
  if (!raw || typeof raw !== "object") return { draft, step: 0 };
  const record = raw as Record<string, unknown>;
  for (const key of NON_SENSITIVE_FIELDS) {
    if (typeof record[key] === "string") draft[key] = record[key] as string;
  }
  let step = 0;
  if (typeof record.step === "number" && Number.isFinite(record.step)) {
    step = Math.min(Math.max(Math.trunc(record.step), 0), APPLICATION_STEPS.length - 1);
  }
  const savedAtIso = typeof record.savedAtIso === "string" ? record.savedAtIso : undefined;
  return { draft, step, savedAtIso };
}

function validateStep(
  step: number,
  draft: Draft,
  documents: readonly AdmissionDocumentRequirement[],
  uploadStates: Record<string, UploadState> = {},
  requireReady = false,
): Record<string, string> {
  const errors: Record<string, string> = {};
  switch (step) {
    case 0:
      if (!draft.session) errors.session = "Select the academic session.";
      if (!draft.grade) errors.grade = "Select the class you are applying for.";
      break;
    case 1:
      if (!draft.studentName.trim()) errors.studentName = "Enter the student's full name.";
      if (!draft.dob) {
        errors.dob = "Enter the date of birth.";
      } else if (Number.isNaN(Date.parse(draft.dob))) {
        errors.dob = "Enter a valid date of birth.";
      } else if (new Date(draft.dob).getTime() > Date.now()) {
        errors.dob = "The date of birth cannot be in the future.";
      }
      if (!draft.gender) errors.gender = "Select gender.";
      if (!draft.placeOfBirth.trim()) errors.placeOfBirth = "Enter the place of birth.";
      break;
    case 2:
      if (!draft.guardianName.trim()) errors.guardianName = "Enter the parent or guardian's full name.";
      if (!draft.relation) errors.relation = "Select the relationship to the student.";
      if (!/^\+?[0-9\s-]{10,15}$/.test(draft.phone.trim())) errors.phone = "Enter a valid phone number, at least 10 digits.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = "Enter a valid email address.";
      break;
    case 3:
      if (!draft.houseStreet.trim()) errors.houseStreet = "Enter the house number and street.";
      if (!draft.villageTown.trim()) errors.villageTown = "Enter the village or town.";
      if (!draft.district.trim()) errors.district = "Enter the district.";
      if (!/^\d{6}$/.test(draft.pin.trim())) errors.pin = "The PIN code must be 6 digits.";
      break;
    case 4:
      if (!draft.priorSchoolName.trim()) errors.priorSchoolName = "Enter the current or last school name.";
      if (!draft.lastClassAttended) errors.lastClassAttended = "Select the class last attended.";
      break;
    case 6:
      for (const doc of documents.filter((candidate) => candidate.required)) {
        const documentRef = draft.documents[doc.code];
        const uploadState = uploadStates[doc.code];
        if (!documentRef) {
          errors[`doc-${doc.code}`] = `Attach the ${doc.label.toLowerCase()}.`;
        } else if (requireReady && uploadState !== "ready") {
          errors[`doc-${doc.code}`] = uploadState === "quarantined"
            ? `Replace the ${doc.label.toLowerCase()}; security scanning quarantined this file.`
            : uploadState === "failed"
              ? `Retry or replace the ${doc.label.toLowerCase()}; processing failed.`
              : `Wait for the ${doc.label.toLowerCase()} security scan, then check its status.`;
        }
      }
      break;
    case 7:
      if (!draft.consent) errors.consent = "Read the declaration and tick the consent box to submit.";
      break;
  }
  return errors;
}

/** Resume a saved draft on the first section that still needs an answer; when
 * every earlier section is complete, land on the documents or review step. */
function resumeStep(draft: Draft): number {
  for (let index = 0; index < 6; index += 1) {
    if (Object.keys(validateStep(index, draft, [])).length > 0) return index;
  }
  return Object.keys(draft.documents).length > 0 ? APPLICATION_STEPS.length - 1 : 6;
}

/** aria-describedby for an input wired to its help/error text. */
function describedBy(id: string, error?: string, help?: string): string | undefined {
  const ids = [error ? `${id}-error` : null, help ? `${id}-help` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

type FieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  full?: boolean;
  children: ReactNode;
};

function Field({ id, label, required, error, help, full, children }: FieldProps) {
  return (
    <div className={`field${error ? " field--invalid" : ""}${full ? ` ${styles.fieldFull}` : ""}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {help ? (
        <p className="field-help" id={`${id}-help`}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  full?: boolean;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  autoComplete?: string;
};

function TextField({ id, label, required, error, help, full, value, onChange, placeholder, inputMode, autoComplete }: TextFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error} help={help} full={full}>
      <input
        id={id}
        className="input"
        type="text"
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy(id, error, help)}
        aria-invalid={error ? true : undefined}
      />
    </Field>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  full?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  placeholder: string;
};

function SelectField({ id, label, required, error, help, full, value, onChange, options, placeholder }: SelectFieldProps) {
  return (
    <Field id={id} label={label} required={required} error={error} help={help} full={full}>
      <select
        id={id}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy(id, error, help)}
        aria-invalid={error ? true : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export type ApplicationFormProps = {
  /** Receives the zero-based step index whenever the step changes. */
  onStepChange?: (index: number) => void;
  /** Receives the selected grade and session whenever either changes. */
  onContextChange?: (context: { grade: string; session: string }) => void;
};

/**
 * Prefill for requested-change editing when no saved draft exists. The
 * latest submitted snapshot carries the answers and attachments of the last
 * submission, so the applicant edits the version the school reviewed instead
 * of re-entering the whole form (and re-uploading every document). Recorded
 * columns overlay the snapshot so a corrected name or contact still shows.
 * Consent always starts empty: the applicant re-confirms before resubmitting.
 */
function draftFromRecord(record: ApplicationRecord): Draft {
  const latestSnapshot = record.versions?.at(-1)?.snapshot;
  const draft =
    latestSnapshot !== undefined && latestSnapshot !== null && typeof latestSnapshot === "object" && Object.keys(latestSnapshot).length > 0
      ? sanitizeDraft(latestSnapshot)
      : emptyDraft();
  if (record.session.trim() !== "") draft.session = record.session;
  if (record.grade.trim() !== "") draft.grade = record.grade;
  if (record.studentName.trim() !== "") draft.studentName = record.studentName;
  if (record.parentName.trim() !== "") draft.guardianName = record.parentName;
  if (/^\+?[0-9\s-]{10,15}$/.test(record.contact)) draft.phone = record.contact;
  draft.consent = false;
  draft.savedAtIso = undefined;
  return draft;
}

/**
 * Overlay a saved draft on a snapshot/record base. Fields the draft leaves
 * empty fall back to the base (an autosaved partial draft created before the
 * applicant touched a section must never erase submitted answers), while
 * attachments merge per requirement so the newest uploaded file wins.
 */
export function mergeSavedDraft(saved: unknown, base: Draft): Draft {
  const restored = sanitizeDraft(saved);
  const draft: Draft = { ...base, documents: { ...base.documents } };
  for (const key of TEXT_FIELDS) {
    if (restored[key] !== "") draft[key] = restored[key];
  }
  if (restored.conditions.length > 0) draft.conditions = restored.conditions;
  if (Object.keys(restored.documents).length > 0) draft.documents = { ...base.documents, ...restored.documents };
  return draft;
}

/**
 * The multi-step student admission form: section-by-section with per-step
 * validation, tab-session draft autosave (non-sensitive fields only, via
 * sessionKey("application-draft")), and a deterministic submission through
 * the admissions service, which issues a reference and moves to the status
 * page. The ?edit=REF query loads an existing application (saved draft or
 * recorded fields) for requested-change editing.
 */
export default function ApplicationForm({ onStepChange, onContextChange }: ApplicationFormProps) {
  const router = useRouter();
  const supabaseMode = clientAdapterMode() === "supabase";
  const [admissionConfiguration, setAdmissionConfiguration] = useState<AdmissionConfiguration | null>(() =>
    supabaseMode ? null : DEMO_ADMISSION_CONFIGURATION,
  );
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /* Autosave truthfulness: lastSavedIso holds an ISO timestamp (or null);
     saveMessage carries non-timestamp status lines ("restored"); saveFailed
     turns the indicator into an honest "Saving failed — retry". */
  const [lastSavedIso, setLastSavedIso] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [editingRef, setEditingRef] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);
  /* Local start-over confirmation replaces a browser confirm() so the
     destructive step keeps a visible context and a safe default. */
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});

  const headingRef = useRef<HTMLHeadingElement>(null);
  const startOverRef = useRef<HTMLButtonElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);
  const onStepChangeRef = useRef(onStepChange);
  const onContextChangeRef = useRef(onContextChange);
  /* Durable save owner and serialized save queue. The resolved application
     reference lives in a ref (not React state) so a queued or in-flight save
     always reads the latest value. One save runs at a time; a save requested
     while another is running replaces any not-yet-started pending save, so a
     fresh journey creates exactly one server draft. */
  const serverOwnerRef = useRef<string | null>(null);
  const serverSaveQueueRef = useRef<{
    running: boolean;
    queued: { draft: Draft; waiters: ServerSaveWaiter[] } | null;
  }>({ running: false, queued: null });

  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  });
  useEffect(() => {
    onContextChangeRef.current = onContextChange;
  });

  useEffect(() => {
    if (!supabaseMode) return;
    let cancelled = false;
    void schoolConfigService.getAdmissionConfiguration().then((configuration) => {
      if (!cancelled) {
        setAdmissionConfiguration(configuration);
        setConfigurationError(null);
      }
    }).catch((error: unknown) => {
      if (!cancelled && clientAdapterMode() === "supabase") {
        setAdmissionConfiguration(null);
        setConfigurationError(error instanceof Error ? error.message : "Admission configuration is unavailable.");
      }
    });
    return () => { cancelled = true; };
  }, [supabaseMode]);

  const documentRequirements = useMemo(
    () => selectAdmissionWindowRequirements(admissionConfiguration, draft.grade, draft.session),
    [admissionConfiguration, draft.grade, draft.session],
  );
  const requiredDocumentRequirements = useMemo(
    () => documentRequirements.filter((requirement) => requirement.required),
    [documentRequirements],
  );

  const refreshDocumentStatus = useCallback(async (key: DocKey, documentRef: string) => {
    if (!documentRef) return;
    setUploadStates((current) => ({ ...current, [key]: "checking" }));
    setUploadErrors((current) => ({ ...current, [key]: "" }));
    try {
      const result = await getDocumentUploadStatus(documentRef);
      const next: UploadState = result.state === "ready"
        ? "ready"
        : result.state === "quarantined"
          ? "quarantined"
          : result.state === "failed" || result.state === "denied" || result.state === "expired"
            ? "failed"
            : "pending";
      setUploadStates((current) => ({ ...current, [key]: next }));
    } catch (error) {
      setUploadStates((current) => ({ ...current, [key]: "failed" }));
      setUploadErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "The document status could not be checked.",
      }));
    }
  }, []);

  /* Restore a draft on mount: the ?edit=REF param loads the application's
     saved draft (or its recorded fields) for requested-change editing;
     otherwise the tab-session draft is restored. */
  useEffect(() => {
    let cancelled = false;
    const editRef = new URLSearchParams(window.location.search).get("edit");

    if (editRef) {
      void (async () => {
        const [saved, record] = await Promise.all([
          admissionsService.getDraft(editRef).catch(() => null),
          admissionsService.getApplication(editRef).catch(() => null),
        ]);
        if (cancelled) return;
        /* A submitted application is immutable; only a draft or a
           requested-change record may open the wizard. A bookmarked or
           historical ?edit= URL goes to the tracking page instead of an
           editable form the service refuses with a conflict. */
        if (record !== null && record.status !== "Draft" && record.status !== "Changes requested") {
          router.replace(`/apply/student/${encodeURIComponent(editRef)}/status`);
          return;
        }
        const isDraft = record === null || record.status === "Draft";
        if (saved || record) {
          /* The snapshot/record base keeps the submitted answers available
             even when the applicant opened the edit page before any draft
             existed, and a saved draft overlays its newer answers. */
          const base = record ? draftFromRecord(record) : emptyDraft();
          const restored = saved ? mergeSavedDraft(saved, base) : base;
          serverOwnerRef.current = editRef;
          setEditingRef(editRef);
          setEditingDraft(isDraft);
          setDraft(restored);
          setCurrentStep(resumeStep(restored));
          for (const [key, documentRef] of Object.entries(restored.documents)) {
            if (documentRef) void refreshDocumentStatus(key, documentRef);
          }
          setSaveMessage(
            isDraft ? "Draft restored for editing" : "Details restored from the submitted application",
          );
          return;
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (supabaseMode) return () => { cancelled = true; };

    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const restored = restoreTabDraft(JSON.parse(raw));
      setDraft(restored.draft);
      setCurrentStep(restored.step);
      if (restored.savedAtIso) {
        setLastSavedIso(restored.savedAtIso);
        setSaveMessage("Draft restored");
      }
    } catch {
      /* Unreadable draft — start fresh. */
    }
  }, [supabaseMode, refreshDocumentStatus, router]);

  /**
   * Serialize every server save through one queue. Each save reads the owner
   * ref at execution time — never a stale React state closure — so only the
   * first save of a fresh journey names "new"; later saves and the document
   * upload always reuse the reference it returned. A save requested while
   * another is running replaces any not-yet-started pending save, so rapid
   * edits coalesce instead of racing.
   */
  const enqueueServerSave = useCallback((draftSnapshot: Draft): Promise<ServerSaveResult> => {
    return new Promise((resolve, reject) => {
      const queue = serverSaveQueueRef.current;
      if (queue.running) {
        if (queue.queued === null) {
          queue.queued = { draft: draftSnapshot, waiters: [] };
        } else {
          queue.queued.draft = draftSnapshot;
        }
        queue.queued.waiters.push({ resolve, reject });
        return;
      }
      queue.running = true;
      let nextDraft = draftSnapshot;
      let waiters: ServerSaveWaiter[] = [{ resolve, reject }];
      void (async () => {
        for (;;) {
          try {
            const saved = await admissionsService.saveDraft(serverOwnerRef.current ?? "new", nextDraft);
            if (serverOwnerRef.current === null && saved.draftRef) {
              serverOwnerRef.current = saved.draftRef;
              setEditingRef(saved.draftRef);
              setEditingDraft(true);
              window.history.replaceState(null, "", `/apply/student?edit=${encodeURIComponent(saved.draftRef)}`);
            }
            setLastSavedIso(new Date().toISOString());
            setSaveMessage(null);
            setSaveFailed(false);
            for (const waiter of waiters) waiter.resolve(saved);
          } catch (error) {
            setSaveFailed(true);
            for (const waiter of waiters) waiter.reject(error);
          }
          const queued = serverSaveQueueRef.current.queued;
          serverSaveQueueRef.current.queued = null;
          if (queued === null) break;
          nextDraft = queued.draft;
          waiters = queued.waiters;
        }
        serverSaveQueueRef.current.running = false;
      })();
    });
  }, []);

  const persistDraft = useCallback(() => {
    /* A brand-new server draft requires session, class, student and guardian
       before the RPC can accept it; autosaving earlier always failed on the
       first keystroke. Wait until the form can actually be persisted. */
    const readyForServer = draft.session.trim() !== "" && draft.grade.trim() !== "" && draft.studentName.trim() !== "" && draft.guardianName.trim() !== "";
    if (editingRef || serverOwnerRef.current || (supabaseMode && readyForServer)) {
      void enqueueServerSave(draft).catch(() => {
        /* The queue already set the save-failed indicator; autosave has no
           other caller to notify. */
      });
      return;
    }
    if (supabaseMode) return;
    try {
      const savedAtIso = new Date().toISOString();
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toTabDraft(draft, currentStep, savedAtIso)));
      setLastSavedIso(savedAtIso);
      setSaveMessage(null);
      setSaveFailed(false);
    } catch {
      /* Storage unavailable — say so honestly instead of a stale "saved". */
      setSaveFailed(true);
    }
  }, [draft, currentStep, editingRef, supabaseMode, enqueueServerSave]);

  /* Autosave (debounced) on every change after the first render. Only
     non-sensitive fields plus section progress are persisted, and only to
     sessionStorage so the draft dies with the tab. While editing an
     application (?edit=REF), the draft lives in the service so the local
     new-application slot is never clobbered. */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = window.setTimeout(persistDraft, 350);
    return () => window.clearTimeout(timer);
  }, [persistDraft]);

  /* Focus the step heading whenever the step changes. */
  useEffect(() => {
    headingRef.current?.focus();
    onStepChangeRef.current?.(currentStep);
  }, [currentStep]);

  /* Keep the rail's context heading (grade + session) in sync. */
  useEffect(() => {
    onContextChangeRef.current?.({ grade: draft.grade, session: draft.session });
  }, [draft.grade, draft.session]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function setDoc(key: DocKey, name: string) {
    setDraft((current) => ({ ...current, documents: { ...current.documents, [key]: name } }));
  }

  async function handleDocumentFile(key: DocKey, file: File | undefined) {
    if (!file) return;
    if (clientAdapterMode() === "demo") {
      setDoc(key, file.name);
      return;
    }
    setUploadStates((current) => ({ ...current, [key]: "uploading" }));
    setUploadErrors((current) => ({ ...current, [key]: "" }));
    try {
      /* The upload owner is durable before the browser requests a signed URL:
       * the serialized save waits for any in-flight save, then names the
       * resolved application reference. No UUID is sent from this component. */
      const saved = await enqueueServerSave(draft);
      const ownerRef = saved.draftRef ?? serverOwnerRef.current;
      if (!ownerRef) throw new Error("Save the application draft before uploading a document.");
      const result = await uploadDocumentFile({
        ownerDomain: "admission_application",
        ownerRecordRef: ownerRef,
        attachmentCode: key,
        file,
        allowedMimeTypes: documentRequirements.find((requirement) => requirement.code === key)?.allowedMimeTypes,
        maxBytes: documentRequirements.find((requirement) => requirement.code === key)?.maxBytes,
      });
      setDoc(key, result.documentRef);
      setUploadStates((current) => ({ ...current, [key]: result.status === "ready" ? "ready" : "pending" }));
    } catch (error) {
      setUploadStates((current) => {
        const next = { ...current };
        if (draft.documents[key]) delete next[key];
        else next[key] = "failed";
        return next;
      });
      setUploadErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : "The upload failed. Choose the file and try again.",
      }));
    }
  }


  function toggleCondition(key: string) {
    setDraft((current) => {
      if (key === "none") {
        return { ...current, conditions: current.conditions.includes("none") ? [] : ["none"] };
      }
      const withoutNone = current.conditions.filter((c) => c !== "none");
      const next = withoutNone.includes(key) ? withoutNone.filter((c) => c !== key) : [...withoutNone, key];
      return { ...current, conditions: next };
    });
  }

  function focusFirstError(nextErrors: Record<string, string>) {
    const firstId = Object.keys(nextErrors)[0];
    if (!firstId) return;
    window.setTimeout(() => document.getElementById(firstId)?.focus(), 0);
  }

  /* While the confirmation is open, land focus on the safe default
     ("Keep editing") and let Escape cancel back to the trigger. */
  useEffect(() => {
    if (!confirmingReset) return;
    cancelResetRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirmingReset(false);
        startOverRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmingReset]);

  function handleStartOver() {
    setConfirmingReset(true);
  }

  function handleCancelReset() {
    setConfirmingReset(false);
    startOverRef.current?.focus();
  }

  function handleConfirmReset() {
    if (!supabaseMode) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* Ignore storage failures. */
      }
    }
    setDraft(emptyDraft());
    setErrors({});
    setLastSavedIso(null);
    setSaveMessage(null);
    setSaveFailed(false);
    setUploadStates({});
    setUploadErrors({});
    setCurrentStep(0);
    setConfirmingReset(false);
    headingRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    /* Intermediate steps: validate this section, then continue. */
    if (currentStep < APPLICATION_STEPS.length - 1) {
      const nextErrors = validateStep(currentStep, draft, requiredDocumentRequirements, uploadStates, supabaseMode);
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        focusFirstError(nextErrors);
        return;
      }
      setErrors({});
      setCurrentStep((step) => Math.min(step + 1, APPLICATION_STEPS.length - 1));
      return;
    }

    /* Final step: validate everything; jump to the first invalid section. */
    for (let step = 0; step < APPLICATION_STEPS.length; step += 1) {
      const stepErrors = validateStep(step, draft, requiredDocumentRequirements, uploadStates, supabaseMode);
      if (Object.keys(stepErrors).length > 0) {
        setErrors(stepErrors);
        setCurrentStep(step);
        focusFirstError(stepErrors);
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const saved = await enqueueServerSave(draft);
      const { ref } = await admissionsService.submitApplication(draft, saved.draftRef ?? serverOwnerRef.current ?? undefined);
      if (!supabaseMode) {
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* Ignore storage failures. */
        }
      }
      router.push(`/apply/student/${ref}/status`);
    } catch {
      setSubmitting(false);
      setSubmitError(
        "We could not submit your application right now. Your answers are still here · please try again.",
      );
    }
  }

  const step = APPLICATION_STEPS[currentStep] ?? APPLICATION_STEPS[0];
  const isLastStep = currentStep === APPLICATION_STEPS.length - 1;
  const errorItems = Object.entries(errors);

  return (
    <section className={styles.workspace} aria-labelledby="step-heading">
      <div className={styles.inner}>
        <div className={styles.intro}>
          <div className={styles.introRow}>
            <div>
              <p className="eyebrow">Step {step.num} of {APPLICATION_STEPS.length.toString().padStart(2, "0")}</p>
              <h2 className={styles.stepHeading} id="step-heading" tabIndex={-1} ref={headingRef}>
                {step.label}
              </h2>
              <p className={styles.introLine}>{STEP_INTRO[currentStep]}</p>
            </div>
            <button
              ref={startOverRef}
              type="button"
              className="button button--quiet"
              onClick={handleStartOver}
              aria-expanded={confirmingReset}
            >
              Start over
            </button>
          </div>
        {editingRef ? (
            <p className={styles.editNote} role="status">
              {editingDraft ? (
                <>
                  Editing draft <strong>{editingRef}</strong> · your answers save to your account as you go.
                </>
              ) : (
                <>
                  Editing application <strong>{editingRef}</strong> · your changes will be re-submitted for review
                  after you submit them.
                </>
              )}
            </p>
          ) : null}
        </div>

        {confirmingReset ? (
          <section className={styles.resetConfirm} aria-labelledby="reset-confirm-title">
            <p className={styles.resetTitle} id="reset-confirm-title">
              Clear this draft and start over?
            </p>
            <p className={styles.resetDesc}>
              This removes the saved draft from this browser and clears every answer in the form. A cleared
              draft cannot be recovered.
            </p>
            <div className={styles.resetActions}>
              <button ref={cancelResetRef} type="button" className="button" onClick={handleCancelReset}>
                Keep editing
              </button>
              <button type="button" className="button button--danger" onClick={handleConfirmReset}>
                Clear draft
              </button>
            </div>
          </section>
        ) : null}
        {configurationError ? <p className={styles.submitError} role="alert">{configurationError}</p> : null}

        {errorItems.length > 0 ? (
          <div className={styles.errorSummary} role="alert">
            <p className={styles.errorSummaryTitle}>Please check the highlighted fields.</p>
            <ul>
              {errorItems.map(([id, message]) => (
                <li key={id}>
                  <strong>{ERROR_LABELS[id] ?? id}</strong> ·{" "}
                  <a href={`#${id}`} aria-label={`${ERROR_LABELS[id] ?? id}: ${message}`}>
                    Review this answer
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.formFields}>
          {currentStep === 0 ? (
            <>
              <SelectField
                id="session"
                label="Academic session"
                required
                error={errors.session}
                value={draft.session}
                onChange={(value) => update({ session: value })}
                options={(admissionConfiguration?.academicYears ?? []).map((year) => ({ value: year.label.replace(/[–—]/g, "-"), label: `Session ${year.label.replace(/[–—]/g, "-")}` }))}
                placeholder="Select session"
              />
              <SelectField
                id="grade"
                label="Class"
                required
                error={errors.grade}
                help="Grade capacity follows the school's confirmed admission policy."
                value={draft.grade}
                onChange={(value) => update({ grade: value })}
                options={(admissionConfiguration?.grades ?? []).map((grade) => ({ value: grade.label, label: grade.label }))}
                placeholder="Select class"
              />
            </>
          ) : null}

          {currentStep === 1 ? (
            <>
              <TextField
                id="studentName"
                label="Full name"
                required
                error={errors.studentName}
                help="As it appears on the birth certificate."
                full
                value={draft.studentName}
                onChange={(value) => update({ studentName: value })}
                autoComplete="name"
              />
              <TextField
                id="dob"
                label="Date of birth"
                required
                error={errors.dob}
                value={draft.dob}
                onChange={(value) => update({ dob: value })}
                placeholder="YYYY-MM-DD"
                inputMode="numeric"
                autoComplete="bday"
              />
              <SelectField
                id="gender"
                label="Gender"
                required
                error={errors.gender}
                value={draft.gender}
                onChange={(value) => update({ gender: value })}
                options={[
                  { value: "Female", label: "Female" },
                  { value: "Male", label: "Male" },
                  { value: "Prefer not to say", label: "Prefer not to say" },
                ]}
                placeholder="Select"
              />
              <TextField
                id="placeOfBirth"
                label="Place of birth"
                required
                error={errors.placeOfBirth}
                full
                value={draft.placeOfBirth}
                onChange={(value) => update({ placeOfBirth: value })}
                placeholder="Village or town, district"
              />
            </>
          ) : null}

          {currentStep === 2 ? (
            <>
              <TextField
                id="guardianName"
                label="Parent / guardian name"
                required
                error={errors.guardianName}
                full
                value={draft.guardianName}
                onChange={(value) => update({ guardianName: value })}
                autoComplete="name"
              />
              <SelectField
                id="relation"
                label="Relationship to the student"
                required
                error={errors.relation}
                value={draft.relation}
                onChange={(value) => update({ relation: value })}
                options={[
                  { value: "Father", label: "Father" },
                  { value: "Mother", label: "Mother" },
                  { value: "Grandparent", label: "Grandparent" },
                  { value: "Other guardian", label: "Other guardian" },
                ]}
                placeholder="Select"
              />
              <TextField
                id="phone"
                label="Phone"
                required
                error={errors.phone}
                value={draft.phone}
                onChange={(value) => update({ phone: value })}
                placeholder="+91 · 10 digits"
                inputMode="tel"
                autoComplete="tel"
              />
              <TextField
                id="email"
                label="Email"
                required
                error={errors.email}
                value={draft.email}
                onChange={(value) => update({ email: value })}
                placeholder="name@example.com"
                inputMode="email"
                autoComplete="email"
              />
              <TextField
                id="occupation"
                label="Occupation"
                help="Optional · helps the admissions office understand the family context."
                full
                value={draft.occupation}
                onChange={(value) => update({ occupation: value })}
              />
            </>
          ) : null}

          {currentStep === 3 ? (
            <>
              <TextField
                id="houseStreet"
                label="House & street"
                required
                error={errors.houseStreet}
                full
                value={draft.houseStreet}
                onChange={(value) => update({ houseStreet: value })}
                autoComplete="street-address"
              />
              <TextField
                id="villageTown"
                label="Village / town"
                required
                error={errors.villageTown}
                value={draft.villageTown}
                onChange={(value) => update({ villageTown: value })}
                autoComplete="address-level2"
              />
              <TextField
                id="district"
                label="District"
                required
                error={errors.district}
                value={draft.district}
                onChange={(value) => update({ district: value })}
                autoComplete="address-level1"
              />
              <TextField
                id="pin"
                label="PIN code"
                required
                error={errors.pin}
                value={draft.pin}
                onChange={(value) => update({ pin: value })}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="6 digits"
              />
            </>
          ) : null}

          {currentStep === 4 ? (
            <>
              <TextField
                id="priorSchoolName"
                label="Current or last school"
                required
                error={errors.priorSchoolName}
                full
                value={draft.priorSchoolName}
                onChange={(value) => update({ priorSchoolName: value })}
              />
              <SelectField
                id="lastClassAttended"
                label="Class last attended"
                required
                error={errors.lastClassAttended}
                value={draft.lastClassAttended}
                onChange={(value) => update({ lastClassAttended: value })}
                options={[5, 6, 7, 8, 9].map((n) => ({ value: `Class ${n}`, label: `Class ${n}` }))}
                placeholder="Select class"
              />
              <TextField
                id="leavingCertificate"
                label="School leaving certificate number"
                help="If it has already been issued."
                value={draft.leavingCertificate}
                onChange={(value) => update({ leavingCertificate: value })}
              />
            </>
          ) : null}

          {currentStep === 5 ? (
            <fieldset className={`${styles.fieldFull} ${styles.checkGroup}`}>
              <legend>Conditions & support needs</legend>
              {CONDITIONS.map((condition) => (
                <label key={condition.key} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    name="conditions"
                    checked={draft.conditions.includes(condition.key)}
                    onChange={() => toggleCondition(condition.key)}
                  />
                  <span>{condition.label}</span>
                </label>
              ))}
              <p className="field-help">
                Select all that apply, or “None”. This section is sensitive: it is visible to fewer staff than the
                rest of the application and is never shown publicly. You may also discuss support needs with the
                school health office after admission.
              </p>
            </fieldset>
          ) : null}

          {currentStep === 6 ? (
            <>
              {requiredDocumentRequirements.map((doc) => {
                const documentRef = draft.documents[doc.code];
                const uploadState = uploadStates[doc.code];
                const uploadError = uploadErrors[doc.code];
                const showUploadStatus = documentRef !== undefined || uploadState !== undefined || uploadError !== undefined;
                const describedByIds = [
                  errors[`doc-${doc.code}`] ? `doc-${doc.code}-error` : null,
                  uploadError ? `doc-${doc.code}-upload-error` : null,
                  `doc-${doc.code}-help`,
                ].filter(Boolean).join(" ");
                return (
                  <Field key={doc.code} id={`doc-${doc.code}`} label={doc.label} required error={errors[`doc-${doc.code}`]} help={documentHelp(doc)}>
                    <input
                      id={`doc-${doc.code}`}
                      className={styles.fileInput}
                      type="file"
                      accept={documentAccept(doc)}
                      onChange={(event) => void handleDocumentFile(doc.code, event.target.files?.[0])}
                      aria-describedby={describedByIds}
                      aria-invalid={errors[`doc-${doc.code}`] || uploadError ? true : undefined}
                    />
                    {showUploadStatus ? (
                      <>
                        {uploadError && uploadState !== "uploading" ? (
                          <p className="field-error" id={`doc-${doc.code}-upload-error`} role="alert">
                            {uploadError}
                          </p>
                        ) : null}
                        {uploadState !== "failed" ? (
                          <p className={styles.fileName} aria-live="polite">
                            {uploadState === "uploading"
                              ? "Uploading…"
                              : uploadState === "checking"
                                ? "Checking scan status…"
                                : uploadState === "ready"
                                  ? "Ready · the scan is complete."
                                  : uploadState === "quarantined"
                                    ? "The uploaded file did not pass the security scan. Upload a clean copy."
                                    : uploadState === "pending"
                                      ? "Uploaded · awaiting the security scan."
                                      : documentRef !== undefined
                                        ? "The earlier upload is still attached. Check the scan status before submitting."
                                        : null}
                          </p>
                        ) : null}
                        {documentRef !== undefined && uploadState !== "uploading" && uploadState !== "ready" ? (
                          <Button
                            variant="quiet"
                            type="button"
                            onClick={() => void refreshDocumentStatus(doc.code, documentRef)}
                            disabled={uploadState === "checking"}
                          >
                            {uploadState === "checking" ? "Checking…" : "Check scan status"}
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </Field>
                );
              })}
              <p className={`${styles.fieldFull} field-help`}>
                {clientAdapterMode() === "demo" ? "Only file names are kept in this demo · no file content is read or transmitted." : "Files are uploaded to private storage and remain pending scan until the server marks them ready."}
              </p>
            </>
          ) : null}

          {currentStep === 7 ? (
            <>
              <div className={styles.fieldFull}>
                <section className={styles.summarySection} aria-label="Academic summary">
                  <h3 className={styles.summaryTitle}>Academic</h3>
                  <dl className={styles.summaryList}>
                    <div className={styles.summaryRow}>
                      <dt>Session</dt>
                      <dd>{draft.session || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Class</dt>
                      <dd>{draft.grade || "—"}</dd>
                    </div>
                  </dl>
                </section>

                <section className={styles.summarySection} aria-label="Student summary">
                  <h3 className={styles.summaryTitle}>Student</h3>
                  <dl className={styles.summaryList}>
                    <div className={styles.summaryRow}>
                      <dt>Full name</dt>
                      <dd>{draft.studentName || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Date of birth</dt>
                      <dd>{draft.dob || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Gender</dt>
                      <dd>{draft.gender || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Place of birth</dt>
                      <dd>{draft.placeOfBirth || "—"}</dd>
                    </div>
                  </dl>
                </section>

                <section className={styles.summarySection} aria-label="Guardian summary">
                  <h3 className={styles.summaryTitle}>Guardian</h3>
                  <dl className={styles.summaryList}>
                    <div className={styles.summaryRow}>
                      <dt>Name</dt>
                      <dd>{draft.guardianName || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Relationship</dt>
                      <dd>{draft.relation || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Phone</dt>
                      <dd>{draft.phone || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Email</dt>
                      <dd>{draft.email || "—"}</dd>
                    </div>
                    {draft.occupation ? (
                      <div className={styles.summaryRow}>
                        <dt>Occupation</dt>
                        <dd>{draft.occupation}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>

                <section className={styles.summarySection} aria-label="Address summary">
                  <h3 className={styles.summaryTitle}>Address</h3>
                  <dl className={styles.summaryList}>
                    <div className={styles.summaryRow}>
                      <dt>House & street</dt>
                      <dd>{draft.houseStreet || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Village / town</dt>
                      <dd>{draft.villageTown || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>District</dt>
                      <dd>{draft.district || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>PIN code</dt>
                      <dd>{draft.pin || "—"}</dd>
                    </div>
                  </dl>
                </section>

                <section className={styles.summarySection} aria-label="Prior school summary">
                  <h3 className={styles.summaryTitle}>Prior school</h3>
                  <dl className={styles.summaryList}>
                    <div className={styles.summaryRow}>
                      <dt>School</dt>
                      <dd>{draft.priorSchoolName || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Class last attended</dt>
                      <dd>{draft.lastClassAttended || "—"}</dd>
                    </div>
                    <div className={styles.summaryRow}>
                      <dt>Leaving certificate</dt>
                      <dd>{draft.leavingCertificate || "Not yet issued"}</dd>
                    </div>
                  </dl>
                </section>

                <section className={styles.summarySection} aria-label="Medical summary">
                  <h3 className={styles.summaryTitle}>Medical & accommodation</h3>
                  <dl className={styles.summaryList}>
                    <div className={styles.summaryRow}>
                      <dt>Conditions</dt>
                      <dd>
                        {draft.conditions.length > 0
                          ? draft.conditions.map((key) => CONDITION_LABELS[key] ?? key).join("; ")
                          : "None declared"}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className={styles.summarySection} aria-label="Documents summary">
                  <h3 className={styles.summaryTitle}>Documents</h3>
                  <dl className={styles.summaryList}>
                    {requiredDocumentRequirements.map((doc) => (
                      <div className={styles.summaryRow} key={doc.code}>
                        <dt>{doc.label}</dt>
                        <dd>{draft.documents[doc.code] ? `Attached · ${draft.documents[doc.code]}` : "Not attached"}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <div className={styles.declaration}>
                  <p>
                    I declare that the information given in this application is true and complete to the best of my
                    knowledge, and I authorise the school to verify it with the previous school and the documents
                    submitted. I understand that any deliberate omission may make the application invalid.
                  </p>
                </div>

                <div className={`field${errors.consent ? " field--invalid" : ""}`}>
                  <label className={styles.checkRow} htmlFor="consent">
                    <input
                      id="consent"
                      type="checkbox"
                      checked={draft.consent}
                      onChange={(event) => update({ consent: event.target.checked })}
                      aria-describedby={errors.consent ? "consent-error" : undefined}
                      aria-invalid={errors.consent ? true : undefined}
                    />
                    <span>
                      I have read the declaration and confirm that the information in this application is true and
                      complete.
                    </span>
                  </label>
                  {errors.consent ? (
                    <p className="field-error" id="consent-error">
                      {errors.consent}
                    </p>
                  ) : null}
                </div>

                <p className="field-help">
                  Submitting creates the application and issues a reference number. The submitted form cannot be
                  edited afterwards. The submit button activates once you tick the declaration.
                </p>
              </div>
            </>
          ) : null}
          </div>

          {submitError ? (
            <p className={styles.submitError} role="alert">
              {submitError}
            </p>
          ) : null}

          <div className={styles.formActions}>
            <Button variant="quiet" onClick={() => setCurrentStep((stepIndex) => Math.max(0, stepIndex - 1))} disabled={currentStep === 0 || submitting}>
              ← Back
            </Button>
            <p className={styles.actionsNote} aria-live="polite">
              {saveFailed ? (
                <>
                  Saving failed ·{" "}
                  <button type="button" className={styles.retryLink} onClick={persistDraft}>
                    retry
                  </button>
                </>
              ) : saveMessage ? (
                saveMessage
              ) : lastSavedIso ? (
                <>
                  <span className="msym" aria-hidden="true">check</span> Draft saved {formatKolkata(lastSavedIso, { format: "time" })}
                </>
              ) : (
                "Draft autosaves in this browser"
              )}
            </p>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || (isLastStep && !draft.consent)}
            >
              {submitting ? "Submitting…" : isLastStep ? "Submit application" : "Save & continue →"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
