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
  | "result_publication"
  | "school_document";

export type DocumentProcessingState = "pending" | "ready" | "quarantined" | "failed" | "denied" | "expired";
export type DocumentFinalizationState = "pending" | "verified" | "failed";
export type DocumentVisibility = "private" | "public_approved";

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
  /** `public_approved` documents appear in the public downloads register. */
  visibility: DocumentVisibility;
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
  visibility?: unknown;
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
    visibility: row.visibility === "public_approved" ? "public_approved" : "private",
  };
}

function uniqueDocuments(rows: PrivateDocumentMetadata[]): PrivateDocumentMetadata[] {
  const seen = new Set<string>();
  return rows.filter((row) => row.ref.length > 0 && !seen.has(row.ref) && seen.add(row.ref));
}

/**
 * Generated report cards are written as `report-card-<releaseReference>.pdf`
 * and the same reference is their immutable source (`document_generation_records.source_reference`).
 * The generation table is service-role only, so the family projection uses
 * this canonical filename as the document-to-release link and keeps the
 * document only while that release is currently published. Anything
 * unmatched is withheld: a withdrawn or superseded release must never
 * surface, while the retained row stays available to staff and audit.
 */
export function generatedReportCardReleaseReference(
  document: Pick<PrivateDocumentMetadata, "category" | "filename">,
): string | null {
  if (document.category !== "generated_report_card") return null;
  const match = /^report-card-(.+)\.pdf$/i.exec(document.filename.trim());
  const reference = match?.[1]?.trim();
  return reference !== undefined && reference.length > 0 ? reference : null;
}

/**
 * Family visibility for the per-student document projection: ordinary
 * documents pass through, generated report cards require their source release
 * to be in the currently published set.
 */
export function isFamilyVisibleDocument(
  document: Pick<PrivateDocumentMetadata, "category" | "filename">,
  publishedReleaseReferences: ReadonlySet<string>,
): boolean {
  if (document.category !== "generated_report_card") return true;
  const releaseReference = generatedReportCardReleaseReference(document);
  return releaseReference !== null && publishedReleaseReferences.has(releaseReference);
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

/**
 * Download gate: only `ready` documents are ever downloadable. Quarantined,
 * denied, expired, failed, and pending documents never yield a download URL —
 * ready delivery is always a signed short-lived URL (`expiresAtIso`) issued
 * by the authorized document route, never a storage key.
 */
export function isDocumentDownloadable(state: DocumentProcessingState): boolean {
  return state === "ready";
}

export function isDocumentMetadataDownloadable(metadata: Pick<PrivateDocumentMetadata, "processingState">): boolean {
  return isDocumentDownloadable(metadata.processingState);
}

export type DocumentDownloadResult =
  | { state: "ready"; url: string; expiresAtIso: string; filename: string }
  | { state: Exclude<DocumentProcessingState, "ready">; message: string };

/** One bounded page of the authorized staff register with an exact total. */
export type StaffDocumentPage = {
  rows: PrivateDocumentMetadata[];
  total: number;
  nextOffset: number | null;
};

export interface DocumentsService {
  listForStudent(accountId: string, studentId: string): Promise<StudentDocumentBundle>;
  listForOwner(ownerDomain: DocumentOwnerDomain, ownerRecordRef: string): Promise<PrivateDocumentMetadata[]>;
  listForStaff(offset?: number, limit?: number): Promise<StaffDocumentPage>;
  requestDownload(documentRef: string): Promise<DocumentDownloadResult>;
  /**
   * Approve a clean, finalized document for the public downloads register, or
   * withdraw it. Resolves with the persisted visibility or throws an honest
   * refusal message when the document is not approvable.
   */
  setPublicVisibility(
    documentRef: string,
    visibility: DocumentVisibility,
  ): Promise<{ ref: string; visibility: DocumentVisibility }>;
}

export const documentsService: DocumentsService = {
  async listForStudent(accountId, studentId) {
    /* Authorization first: the student must be reachable through an active
       guardian link for this account, or the bundle is denied. */
    const contexts = await familyContextService.listAccessibleStudentContexts(accountId);
    const context = contexts.find((candidate) => candidate.student.id === studentId);
    if (context === undefined) throw new Error("These documents are not accessible to this account.");

    /* Supabase mode derives the term list from the same releases read, so the
       documents bundle costs one releases request instead of two. Demo mode
       keeps the fixture term list (it carries not-published terms too). */
    const supabaseMode = clientAdapterMode() === "supabase";
    const [terms, publications, receipts] = await Promise.all([
      supabaseMode ? Promise.resolve(null) : academicsService.getTerms(),
      academicsService.getPublications(),
      financeService.listReceipts(),
    ]);
    const bundleTerms = supabaseMode
      ? publications.map((publication) => ({
          id: publication.ref,
          label: publication.term,
          publicationStatus: publication.status,
          publishedAtIso: publication.publishedAtIso ?? undefined,
          version: publication.version,
        }))
      : (terms ?? []);
    const studentReceipts = receipts.filter((receipt) => receipt.studentId === studentId);

    let metadata: PrivateDocumentMetadata[] | undefined;
    if (clientAdapterMode() === "supabase") {
      const invoiceRefs = [...new Set(studentReceipts.map((receipt) => receipt.invoiceRef))];
      metadata = await listSupabaseDocuments([
        { ownerDomain: "student", ownerRecordRef: context.student.ref },
        ...invoiceRefs.map((ownerRecordRef) => ({ ownerDomain: "invoice" as const, ownerRecordRef })),
      ]);
    }

    const reportCards: ReportCardDocument[] = bundleTerms.map((term) => {
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

    /* The report-card panel and the private-files register must agree: only
       generated report cards for releases the family can currently read as
       published stay in the bundle. */
    if (metadata !== undefined) {
      const publishedReleaseReferences = new Set(
        reportCards
          .map((card) => card.publicationRef)
          .filter((reference): reference is string => reference !== null),
      );
      metadata = metadata.filter((document) => isFamilyVisibleDocument(document, publishedReleaseReferences));
    }

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

  async listForStaff(offset = 0, limit = 50) {
    if (clientAdapterMode() !== "supabase") return { rows: [], total: 0, nextOffset: null };
    const result = await adapterCall<{ rows: RawDocumentMetadata[]; total: number; nextOffset: number | null }>(
      "documents.listPage",
      { offset, limit },
    );
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "Documents are unavailable.");
    return {
      rows: uniqueDocuments(result.value.rows.map(mapPrivateDocumentMetadata)),
      total: result.value.total,
      nextOffset: result.value.nextOffset,
    };
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

  async setPublicVisibility(documentRef, visibility) {
    if (clientAdapterMode() !== "supabase") {
      throw new Error("Public register approval is not available in demo mode.");
    }
    const response = await adapterCall<RawDocumentMetadata>("documents.setPublicVisibility", {
      reference: documentRef,
      visibility,
    });
    if (!response.ok) throw new Error(response.errors[0]?.message ?? "The document visibility could not be changed.");
    return {
      ref: stringOrNull(response.value.ref) ?? stringOrNull(response.value.reference) ?? documentRef,
      visibility: response.value.visibility === "public_approved" ? "public_approved" : "private",
    };
  },
};

export const createDocumentsService = (): DocumentsService => documentsService;
