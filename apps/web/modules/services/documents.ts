/**
 * Typed documents-service boundary for the family portal: per-student
 * document metadata derived from the owning domain services.
 *
 * - Report cards come from the academics service (terms + publications).
 * - Receipts come from the finance service ledger.
 * - Student/enrollment references come from the family context service.
 * - Certificates are empty in the demo (the portal keeps its empty state).
 *
 * The demo adapter never returns private files — only metadata for preview
 * dialogs. The backend phase adds authorized delivery behind these signatures.
 */

import { academicsService } from "@/modules/services/academics";
import { familyContextService, gradeSectionLabel } from "@/modules/services/family-context";
import { financeService, type Receipt } from "@/modules/services/finance";

export { formatINR } from "@/modules/finance/demo";

/** Report-card metadata for one term, tied to its immutable publication. */
export type ReportCardDocument = {
  termId: string;
  termLabel: string;
  publicationStatus: "final" | "provisional" | "not-published";
  publishedAtIso: string | null;
  version: number | null;
  /** Publication reference when the term has been published. */
  publicationRef: string | null;
  correctionNote: string | null;
};

/** A receipt from the finance ledger, presented as a document record. */
export type ReceiptDocument = Receipt;

/** Certificate records; the demo has none, so the portal keeps its empty state. */
export type CertificateDocument = {
  ref: string;
  title: string;
  issuedAtIso: string | null;
};

/** Everything the portal documents page renders for one linked child. */
export type StudentDocumentBundle = {
  studentId: string;
  studentRef: string;
  enrollmentRef: string;
  gradeSectionLabel: string;
  reportCards: ReportCardDocument[];
  receipts: ReceiptDocument[];
  certificates: CertificateDocument[];
};

export interface DocumentsService {
  /** The document bundle for one student, only when linked to the account. */
  listForStudent(accountId: string, studentId: string): Promise<StudentDocumentBundle>;
}

export const documentsService: DocumentsService = {
  async listForStudent(accountId, studentId) {
    /* Authorization first: the student must be reachable through an active
       guardian link for this account, or the bundle is denied. */
    const contexts = await familyContextService.listAccessibleStudentContexts(accountId);
    const context = contexts.find((candidate) => candidate.student.id === studentId);
    if (context === undefined) {
      throw new Error("These documents are not accessible to this account.");
    }

    const [terms, publications, receipts] = await Promise.all([
      academicsService.getTerms(),
      academicsService.getPublications(),
      financeService.listReceipts(),
    ]);

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

    /* The finance ledger is student-scoped: each receipt names its owning
       student, so only this child's receipts appear in the bundle. */
    const studentReceipts = receipts.filter((receipt) => receipt.studentId === studentId);

    return {
      studentId,
      studentRef: context.student.ref,
      enrollmentRef: context.enrollment.ref,
      gradeSectionLabel: gradeSectionLabel(context.gradeSection),
      reportCards,
      receipts: studentReceipts.map((receipt) => ({ ...receipt })),
      certificates: [],
    };
  },
};

/** Named demo-only export for callers that prefer a factory-shaped service. */
export const createDocumentsService = (): DocumentsService => documentsService;
