/**
 * Protected data export service (Phase 7 / 11.5 completion) — Administrator
 * only, purpose-bound, column-allowlisted, formula-safe, private, expiring,
 * and audited.
 *
 * Supabase mode exchanges catalog/list/request/cancel/retry through the
 * same-origin adapter gateway and mints signed downloads through the
 * authorized route. Demo mode never fabricates a successful file operation:
 * it reports the adapter as unavailable so the workspace can state that
 * protected exports require the live school database.
 */

import { adapterCall, clientAdapterMode } from "@/modules/services/adapter-client";

export type ExportDomain =
  | "students"
  | "guardians"
  | "guardian_student_links"
  | "enrollments"
  | "admissions"
  | "invoices"
  | "results";

export type ExportCatalogColumn = {
  column: string;
  label: string;
  type: string;
};

export type ExportCatalogFilter = {
  filter: string;
  label: string;
  type: string;
};

export type ExportCatalog = {
  id: string;
  reference: string;
  domain: ExportDomain;
  displayName: string;
  description: string;
  availableColumns: ExportCatalogColumn[];
  optionalFilters: ExportCatalogFilter[];
  maxRows: number;
};

export type ExportRequestRow = {
  requestId: string;
  reference: string;
  domain: string;
  state: "requested" | "generating" | "ready" | "failed" | "expired" | "cancelled";
  format: string;
  rowCount: number | null;
  purpose: string;
  expiresAt: string | null;
  createdAt: string;
  /** Latest recorded event type for the request (event, queue failure, or none). */
  lastEventType: string | null;
  /** Bounded failure reason when the latest signal is a failure; otherwise the latest event detail. */
  lastEventDetail: string | null;
  /** When the current failure was recorded; null unless the export is failed. */
  failedAt: string | null;
};

export type ExportRequestInput = {
  domain: ExportDomain;
  filters: Record<string, string>;
  columns: string[];
  format: "csv";
  purpose: string;
  reason: string;
};

export type ExportRequestResult = {
  reference: string;
  state: string;
  version?: number;
};

const DEMO_UNAVAILABLE = "Protected exports require the live school database. Demo mode does not generate download files.";

function catalogColumns(value: unknown): ExportCatalogColumn[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.column !== "string" || record.column === "") return [];
    return [{
      column: record.column,
      label: typeof record.label === "string" ? record.label : record.column,
      type: typeof record.type === "string" ? record.type : "text",
    }];
  });
}

function catalogFilters(value: unknown): ExportCatalogFilter[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.filter !== "string" || record.filter === "") return [];
    return [{
      filter: record.filter,
      label: typeof record.label === "string" ? record.label : record.filter,
      type: typeof record.type === "string" ? record.type : "text",
    }];
  });
}

function mapCatalog(row: Record<string, unknown>): ExportCatalog {
  return {
    id: String(row.id ?? ""),
    reference: String(row.reference ?? ""),
    domain: row.domain as ExportDomain,
    displayName: String(row.display_name ?? row.displayName ?? row.domain ?? ""),
    description: String(row.description ?? ""),
    availableColumns: catalogColumns(row.available_columns ?? row.availableColumns),
    optionalFilters: catalogFilters(row.optional_filters ?? row.optionalFilters),
    maxRows: Number(row.max_rows ?? row.maxRows ?? 0),
  };
}

function optionalText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapRequest(row: Record<string, unknown>): ExportRequestRow {
  return {
    requestId: String(row.requestId ?? row.id ?? ""),
    reference: String(row.reference ?? ""),
    domain: String(row.domain ?? ""),
    state: (row.state ?? "requested") as ExportRequestRow["state"],
    format: String(row.format ?? "csv"),
    rowCount: row.rowCount === null || row.rowCount === undefined ? null : Number(row.rowCount),
    purpose: String(row.purpose ?? ""),
    expiresAt: row.expiresAt === null || row.expiresAt === undefined ? null : String(row.expiresAt),
    createdAt: String(row.createdAt ?? row.created_at ?? ""),
    lastEventType: optionalText(row.lastEventType),
    lastEventDetail: optionalText(row.lastEventDetail),
    failedAt: optionalText(row.failedAt),
  };
}

export type ExportRequestPage = {
  rows: ExportRequestRow[];
  nextCursor: string | null;
};

export interface DataExportService {
  listCatalogs(): Promise<ExportCatalog[]>;
  listRequests(): Promise<ExportRequestRow[]>;
  /** Bounded first page of export requests (keyset cursor, newest first). */
  listRequestsPage(cursor?: string | null, limit?: number): Promise<ExportRequestPage>;
  request(input: ExportRequestInput): Promise<ExportRequestResult>;
  cancel(reference: string, reason: string): Promise<void>;
  retry(reference: string, reason: string): Promise<void>;
  /** Release a stale generating request whose worker died at the queue layer. */
  recover(requestId: string, reason: string): Promise<void>;
  /** Server-authorized short-lived signed URL for a ready artifact. */
  signedDownloadUrl(reference: string): Promise<string>;
}

export const dataExportService: DataExportService = {
  async listCatalogs() {
    if (clientAdapterMode() !== "supabase") return [];
    const result = await adapterCall<Array<Record<string, unknown>>>("dataExports.listCatalog", {});
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "The export catalog is unavailable.");
    return result.value.map(mapCatalog);
  },

  async listRequests() {
    if (clientAdapterMode() !== "supabase") return [];
    const result = await adapterCall<Array<Record<string, unknown>>>("dataExports.list", {});
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "Export requests are unavailable.");
    return result.value.map(mapRequest);
  },

  async listRequestsPage(cursor = null, limit = 20) {
    if (clientAdapterMode() !== "supabase") return { rows: [], nextCursor: null };
    const result = await adapterCall<Record<string, unknown>>("dataExports.listPaginated", { cursor, limit });
    /* 000110 repaired the keyset RPC (`jsonb - integer` trim, text cursor).
       A page failure now surfaces as the honest error panel — never a silent
       fall back to the unpaged projection, which would hide the failure and
       drop pagination. */
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "Export requests are unavailable.");
    const rawRows = Array.isArray(result.value.rows) ? (result.value.rows as Array<Record<string, unknown>>) : [];
    return {
      rows: rawRows.map(mapRequest),
      nextCursor: typeof result.value.nextCursor === "string" && result.value.nextCursor !== "" ? result.value.nextCursor : null,
    };
  },

  async request(input) {
    if (clientAdapterMode() !== "supabase") throw new Error(DEMO_UNAVAILABLE);
    const result = await adapterCall<Record<string, unknown>>("dataExports.request", {
      domain: input.domain,
      filters: input.filters,
      columns: input.columns,
      format: input.format,
      purpose: input.purpose,
      reason: input.reason,
    });
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "The export request failed.");
    return {
      reference: String(result.value.reference ?? ""),
      state: String(result.value.state ?? "requested"),
      version: result.value.version === undefined ? undefined : Number(result.value.version),
    };
  },

  async cancel(reference, reason) {
    if (clientAdapterMode() !== "supabase") throw new Error(DEMO_UNAVAILABLE);
    const result = await adapterCall<Record<string, unknown>>("dataExports.cancel", { requestReference: reference, reason });
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "The export could not be cancelled.");
  },

  async retry(reference, reason) {
    if (clientAdapterMode() !== "supabase") throw new Error(DEMO_UNAVAILABLE);
    const result = await adapterCall<Record<string, unknown>>("dataExports.retry", { requestReference: reference, reason });
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "The export could not be retried.");
  },

  async recover(requestId, reason) {
    if (clientAdapterMode() !== "supabase") throw new Error(DEMO_UNAVAILABLE);
    const result = await adapterCall<Record<string, unknown>>("dataExports.recover", { requestId, reason });
    if (!result.ok) throw new Error(result.errors[0]?.message ?? "The stuck export could not be recovered.");
  },

  async signedDownloadUrl(reference) {
    if (clientAdapterMode() !== "supabase") throw new Error(DEMO_UNAVAILABLE);
    const response = await fetch(`/api/data-exports/${encodeURIComponent(reference)}/download`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as { signedUrl?: unknown; error?: unknown } | null;
    if (!response.ok || typeof body?.signedUrl !== "string") {
      throw new Error(typeof body?.error === "string" ? body.error : "The download could not be created.");
    }
    return body.signedUrl;
  },
};
