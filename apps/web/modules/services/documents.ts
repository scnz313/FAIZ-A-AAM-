/**
 * Typed document boundary for portal, applicant, and scoped staff surfaces.
 * Object keys and buckets never enter these contracts; private delivery is
 * always requested from the same-origin authorized document route.
 */

import { academicsService } from "@/modules/services/academics";
import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";
import { familyContextService, gradeSectionLabel } from "@/modules/services/family-context";
import { financeService, type Receipt } from "@/modules/services/finance";

export { formatINR } from "@/modules/finance/demo";

export type DocumentOwnerDomain =
  | "admission_application"
  | "job_application"
  | "student"
  | "invoice"
  | "result_publication";

export type DocumentProcessingState = "pending" | "ready" | "quarantined" | "failed" | "denied" | "expired";
export type DocumentFinalizationState = "pending" | "verified" | "failed";

export type PrivateDocumentMetadata = {
  ref: string;
  ownerDomain: DocumentOwnerDomain | string;
  ownerReference: string | null;
  attachmentCode: string | null;
  category: string;
  filename: string;
  processingState: DocumentProcessingState;
  scanState: string;
  finalizationState: DocumentFinalizationState;
  checksumVerified: boolean;
  finalizedAtIso: string | null;
  retentionUntilIso: string | null;
  mimeType: string;
  sizeBytes: number;
  version: number;
  createdAtIso: string | null;
  updatedAtIso: string | null;
};

type RawDocumentMetadata = {
  reference?: unknown;
  ref?: unknown;
  ownerDomain?: unknown;
  owner_domain?: unknown;
  ownerReference?: unknown;
  owner_reference?: unknown;
  attachmentCode?: unknown;
  attachment_code?: unknown;
  category?: unknown;
  filename?: unknown;
  safe_filename?: unknown;
  status?: unknown;
  processingState?: unknown;
  scanState?: unknown;
  scan_status?: unknown;
  finalizationState?: unknown;
  checksumVerified?: unknown;
  checksum_verified?: unknown;
  finalizedAt?: unknown;
  finalized_at?: unknown;
  retentionUntil?: unknown;
  retention_until?: unknown;
  mimeType?: unknown;
  mime_type?: unknown;
  sizeBytes?: unknown;
  size_bytes?: unknown;
  version?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  updatedAt?: unknown;
  updated_at?: unknown;
};

const stringOrNull = (value: unknown): string | null => typeof value === "string" && value.length > 0 ? value : null;
const numberOr = (value: unknown, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function normalizeDocumentProcessingState(value: unknown): DocumentProcessingState {
  switch (value) {
    case "ready":
    case "clean":
      return "ready";
    case "quarantined":
    case "quarantine":
      return "quarantined";
    case "failed":
      return "failed";
    case "denied":
      return "denied";
    case "expired":
    case "deleted":
      return "expired";
    case "pending":
    case "pending_scan":
    case "uploading":
    case "finalizing":
    default:
      return "pending";
  }
}

/** Map a provider/database projection into the only metadata shape UI receives. */
export function mapPrivateDocumentMetadata(row: RawDocumentMetadata): PrivateDocumentMetadata {
  const scanState = stringOrNull(row.scanState) ?? stringOrNull(row.scan_status) ?? stringOrNull(row.status) ?? "pending_scan";
  const processingState = normalizeDocumentProcessingState(row.processingState ?? row.status ?? scanState);
  const checksumVerified = row.checksumVerified === true || row.checksum_verified === true;
  const finalizedAtIso = stringOrNull(row.finalizedAt) ?? stringOrNull(row.finalized_at);
  const rawFinalization = stringOrNull(row.finalizationState);
  const finalizationState: DocumentFinalizationState = rawFinalization === "verified" || rawFinalization === "failed"
    ? rawFinalization
    : checksumVerified && finalizedAtIso !== null
      ? "verified"
      : processingState === "failed"
        ? "failed"
        : "pending";

  return {
    ref: stringOrNull(row.ref) ?? stringOrNull(row.reference) ?? "",
    ownerDomain: stringOrNull(row.ownerDomain) ?? stringOrNull(row.owner_domain) ?? "unknown",
    ownerReference: stringOrNull(row.ownerReference) ?? stringOrNull(row.owner_reference),
    attachmentCode: stringOrNull(row.attachmentCode) ?? stringOrNull(row.attachment_code),
    category: stringOrNull(row.category) ?? "document",
    filename: stringOrNull(row.filename) ?? stringOrNull(row.safe_filename) ?? "Document",
    processingState,
    scanState,
    finalizationState,
    checksumVerified,
    finalizedAtIso,
    retentionUntilIso: stringOrNull(row.retentionUntil) ?? stringOrNull(row.retention_until),
    mimeType: stringOrNull(row.mimeType) ?? stringOrNull(row.mime_type) ?? "application/octet-stream",
    sizeBytes: Math.max(0, numberOr(row.sizeBytes ?? row.size_bytes, 0)),
    version: Math.max(1, numberOr(row.version, 1)),
    createdAtIso: stringOrNull(row.createdAt) ?? stringOrNull(row.created_at),
    updatedAtIso: stringOrNull(row.updatedAt) ?? stringOrNull(row.updated_at),
  };
}

function uniqueDocuments(rows: PrivateDocumentMetadata[]): PrivateDocumentMetadata[] {
  const seen = new Set<string>();
  return rows.filter((row) => row.ref.length > 0 && !seen.has(row.ref) && seen.add(row.ref));
}

async function listSupabaseDocuments(
  targets: ReadonlyArray<{ ownerDomain: DocumentOwnerDomain; ownerRecordRef: string }>,
): Promise<PrivateDocumentMetadata[]> {
  const results = await Promise.all(targets.map((target) => adapterCall<RawDocumentMetadata[]>("documents.list", target)));
  const denied = results.find((result) => !result.ok);
  if (denied && !denied.ok) throw new Error(denied.errors[0]?.message ?? "Documents are unavailable.");
  return uniqueDocuments(results.flatMap((result) => result.ok ? result.value.map(mapPrivateDocumentMetadata) : []));
}

/** Report-card metadata for one term, tied to its immutable publication. */
export type ReportCardDocument = {
  termId: string;
  termLabel: string;
  publicationStatus: "final" | "provisional" | "not-published";
  publishedAtIso: string | null;
  version: number | null;
  publicationRef: string | null;
  correctionNote: string | null;
};

export type ReceiptDocument = Receipt;

export type CertificateDocument = {
  ref: string;
  title: string;
  issuedAtIso: string | null;
};

export type StudentDocumentBundle = {
  studentId: string;
  studentRef: string;
  enrollmentRef: string;
  gradeSectionLabel: string;
  reportCards: ReportCardDocument[];
  receipts: ReceiptDocument[];
  certificates: CertificateDocument[];
  /** Undefined only in the deliberately metadata-only demo adapter. */
  metadata?: PrivateDocumentMetadata[];
};

export type DocumentDownloadResult =
  | { state: "ready"; url: string; expiresAtIso: string; filename: string }
  | { state: Exclude<DocumentProcessingState, "ready">; message: string };

export interface DocumentsService {
  listForStudent(accountId: string, studentId: string): Promise<StudentDocumentBundle>;
  listForOwner(ownerDomain: DocumentOwnerDomain, ownerRecordRef: string): Promise<PrivateDocumentMetadata[]>;
  listForStaff(): Promise<PrivateDocumentMetadata[]>;
  requestDownload(documentRef: string): Promise<DocumentDownloadResult>;
}

export const documentsService: DocumentsService = {
  async listForStudent(accountId, studentId) {
    /* Authorization first: the student must be reachable through an active
       guardian link for this account, or the bundle is denied. */
    const contexts = await familyContextService.listAccessibleStudentContexts(accountId);
    const context = contexts.find((candidate) => candidate.student.id === studentId);
    if (context === undefined) throw new Error("These documents are not accessible to this account.");

    const [terms, publications, receipts] = await Promise.all([
      academicsService.getTerms(),
      academicsService.getPublications(),
      financeService.listReceipts(),
    ]);
    const studentReceipts = receipts.filter((receipt) => receipt.studentId === studentId);

    let metadata: PrivateDocumentMetadata[] | undefined;
    if (clientAdapterMode() === "supabase") {
      const invoiceRefs = [...new Set(studentReceipts.map((receipt) => receipt.invoiceRef))];
      metadata = await listSupabaseDocuments([
        { ownerDomain: "student", ownerRecordRef: context.student.ref },
        ...invoiceRefs.map((ownerRecordRef) => ({ ownerDomain: "invoice" as const, ownerRecordRef })),
      ]);
    }

    const reportCards: ReportCardDocument[] = terms.map((term) => {
      const publication = publications.find((item) => item.term === term.label);
      return {
        termId: term.id,
        termLabel: term.label,
        publicationStatus: term.publicationStatus,
        publishedAtIso: term.publishedAtIso ?? null,
        version: term.version ?? null,
        publicationRef: publication?.ref ?? null,
        correctionNote: publication?.correctionNote ?? null,
      };
    });

    return {
      studentId,
      studentRef: context.student.ref,
      enrollmentRef: context.enrollment.ref,
      gradeSectionLabel: gradeSectionLabel(context.gradeSection),
      reportCards,
      receipts: studentReceipts.map((receipt) => ({ ...receipt })),
      certificates: [],
      metadata,
    };
  },

  async listForOwner(ownerDomain, ownerRecordRef) {
    if (clientAdapterMode() !== "supabase") return [];
    return listSupabaseDocuments([{ ownerDomain, ownerRecordRef }]);
  },

  async listForStaff() {
    if (clientAdapterMode() !== "supabase") return [];
    const result = await adapterCall<RawDocumentMetadata[]>("documents.list", {});
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "Documents are unavailable.");
    return uniqueDocuments(result.value.map(mapPrivateDocumentMetadata));
  },

  async requestDownload(documentRef) {
    if (clientAdapterMode() !== "supabase") {
      return { state: "failed", message: "Private downloads are not active in demo mode." };
    }
    const response = await fetch(`/api/documents/${encodeURIComponent(documentRef)}?response=json`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as {
      state?: unknown;
      url?: unknown;
      expiresAtIso?: unknown;
      filename?: unknown;
      error?: unknown;
    } | null;

    if (
      response.ok
      && body?.state === "ready"
      && typeof body.url === "string"
      && typeof body.expiresAtIso === "string"
    ) {
      return {
        state: "ready",
        url: body.url,
        expiresAtIso: body.expiresAtIso,
        filename: typeof body.filename === "string" ? body.filename : "document",
      };
    }

    const state = response.status === 401 || response.status === 403 || response.status === 404
      ? "denied"
      : normalizeDocumentProcessingState(body?.state ?? (response.status === 410 ? "expired" : "failed"));
    return {
      state: state === "ready" ? "failed" : state,
      message: typeof body?.error === "string" ? body.error : "The document could not be downloaded. Please try again.",
    };
  },
};

export const createDocumentsService = (): DocumentsService => documentsService;
