/**
 * Bounded finance register paging (server + client safe).
 *
 * The invoice/attempt registers grow with the school (one invoice per student
 * per term), so staff surfaces render one page plus an exact total instead of
 * every nested projection. These pure helpers keep the page math identical in
 * the server loader and its tests.
 */

export const FINANCE_REGISTER_PAGE_SIZE = 50;

export type RegisterRange = { from: number; to: number };

export type RegisterView = {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  shownFrom: number;
  shownTo: number;
};

/** Parse a `?page=` value. Missing or malformed values clamp to page 1. */
export function parseFinanceRegisterPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

export function financeRegisterRange(page: number, pageSize: number = FINANCE_REGISTER_PAGE_SIZE): RegisterRange {
  const from = (Math.max(Math.trunc(page), 1) - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/** Resolve the rendered page against the exact total. A requested page past
 *  the end resolves to the last real page. */
export function financeRegisterView(requestedPage: number, total: number, pageSize: number = FINANCE_REGISTER_PAGE_SIZE): RegisterView {
  const pageCount = Math.max(1, Math.ceil(Math.max(total, 0) / pageSize));
  const page = Math.min(Math.max(Math.trunc(requestedPage), 1), pageCount);
  const { from, to } = financeRegisterRange(page, pageSize);
  const count = Math.max(total, 0);
  return {
    page,
    pageCount,
    from,
    to,
    shownFrom: count === 0 ? 0 : from + 1,
    shownTo: Math.min(to + 1, count),
  };
}
