// @vitest-environment node
/**
 * Finance register paging math: page parsing, ranges, and the rendered view
 * bounds that keep a paged register honest about how many rows exist.
 */
import { describe, expect, it } from "vitest";

import {
  FINANCE_REGISTER_PAGE_SIZE,
  financeRegisterRange,
  financeRegisterView,
  parseFinanceRegisterPage,
} from "@/modules/services/finance-register";

describe("parseFinanceRegisterPage", () => {
  it("clamps missing, malformed, and negative values to page 1", () => {
    expect(parseFinanceRegisterPage(undefined)).toBe(1);
    expect(parseFinanceRegisterPage([])).toBe(1);
    expect(parseFinanceRegisterPage("abc")).toBe(1);
    expect(parseFinanceRegisterPage("0")).toBe(1);
    expect(parseFinanceRegisterPage("-4")).toBe(1);
    expect(parseFinanceRegisterPage("7")).toBe(7);
    expect(parseFinanceRegisterPage(["3", "9"])).toBe(3);
  });
});

describe("financeRegisterRange", () => {
  it("maps a page to an inclusive zero-based range", () => {
    expect(financeRegisterRange(1, 50)).toEqual({ from: 0, to: 49 });
    expect(financeRegisterRange(3, 50)).toEqual({ from: 100, to: 149 });
  });
});

describe("financeRegisterView", () => {
  it("reports the occupied range and exact total", () => {
    const view = financeRegisterView(2, 1250);
    expect(view).toEqual({
      page: 2,
      pageCount: 25,
      from: FINANCE_REGISTER_PAGE_SIZE,
      to: FINANCE_REGISTER_PAGE_SIZE * 2 - 1,
      shownFrom: FINANCE_REGISTER_PAGE_SIZE + 1,
      shownTo: FINANCE_REGISTER_PAGE_SIZE * 2,
    });
  });

  it("resolves a page past the end to the last real page", () => {
    const view = financeRegisterView(99, 120);
    expect(view.page).toBe(3);
    expect(view.shownFrom).toBe(101);
    expect(view.shownTo).toBe(120);
  });

  it("renders a single empty page for an empty register", () => {
    const view = financeRegisterView(1, 0);
    expect(view).toMatchObject({ page: 1, pageCount: 1, shownFrom: 0, shownTo: 0 });
  });
});
