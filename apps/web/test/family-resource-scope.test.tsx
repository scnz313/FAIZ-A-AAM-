/**
 * Phase 2 wrong-child resource scope (plan.md): a portal receipt's owning
 * student is classified against the signed-in family account and the page
 * responds accordingly — "current" renders normally, "other" (a linked
 * sibling) renders the record with an owning-child panel and a working
 * switch control, "none" (unlinked owner) renders a neutral denial with no
 * record details, and null owners (admission records before conversion)
 * render as "current".
 *
 * The classifier is exercised directly against the relationships service,
 * and the receipt page is exercised through the real provider and adapters.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ReceiptView } from "@/app/portal/receipts/[receiptRef]/ReceiptView";
import { FamilyContextProvider } from "@/components/portal/FamilyContextProvider";
import { setDemoNow } from "@/modules/demo/clock";
import { STUDENT_AARIF_ID, STUDENT_MARIAM_ID } from "@/modules/finance/demo";
import type { Invoice, Receipt } from "@/modules/finance/demo";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { FINANCE_SESSION_KEYS } from "@/modules/services/finance";
import { sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");

/** Zoya Khan (STU-2026-0903) — linked to another account, not this one. */
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000009999";

/** Ledger rows for a record owned by an unlinked student. */
const UNLINKED_INVOICE: Invoice = {
  ref: "INV-2026-0999",
  studentId: ZOYA_ID,
  term: "Term 1",
  issuedAtIso: "2026-04-01T06:00:00Z",
  dueAtIso: "2026-04-20T14:00:00Z",
  status: "paid",
  items: [{ label: "Tuition fee", amountPaise: 600000, kind: "fee" }],
  payments: [
    { ref: "PAY-2026-0999", paidAtIso: "2026-04-05T08:30:00Z", method: "UPI", amountPaise: 600000, receiptRef: "RC-2026-0999" },
  ],
};

const UNLINKED_RECEIPT: Receipt = {
  ref: "RC-2026-0999",
  invoiceRef: "INV-2026-0999",
  studentId: ZOYA_ID,
  issuedAtIso: "2026-04-05T08:30:00Z",
  method: "UPI",
  amountPaise: 600000,
  counter: "Finance office",
};

/** Ledger rows for a null-owned admission record (pre-enrollment conversion). */
const ADMISSION_INVOICE: Invoice = {
  ref: "INV-2026-0888",
  studentId: null,
  applicantRef: "APP-2026-0777",
  term: "Admission",
  issuedAtIso: "2026-04-01T06:00:00Z",
  dueAtIso: "2026-04-20T14:00:00Z",
  status: "paid",
  items: [{ label: "Admission fee — Class 6, session 2026–27", amountPaise: 600000, kind: "fee" }],
  payments: [
    { ref: "PAY-2026-0888", paidAtIso: "2026-04-05T08:30:00Z", method: "UPI", amountPaise: 600000, receiptRef: "RC-2026-0888" },
  ],
};

const ADMISSION_RECEIPT: Receipt = {
  ref: "RC-2026-0888",
  invoiceRef: "INV-2026-0888",
  studentId: null,
  issuedAtIso: "2026-04-05T08:30:00Z",
  method: "UPI",
  amountPaise: 600000,
  counter: "Finance office",
};

function clearDemoSession(): void {
  window.sessionStorage.clear();
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  Object.values(FINANCE_SESSION_KEYS).forEach((key) => sessionRemove(key));
}

beforeEach(() => {
  clearDemoSession();
  setDemoNow(PINNED);
});

afterEach(() => {
  clearDemoSession();
  setDemoNow(null);
});

function renderReceipt(receiptRef: string): void {
  render(
    <FamilyContextProvider>
      <ReceiptView receiptRef={receiptRef} />
    </FamilyContextProvider>,
  );
}

describe("classifyStudentAccess", () => {
  it("classifies the active child as current", async () => {
    expect(await familyContextService.classifyStudentAccess(DEMO_GUARDIAN_ACCOUNT_ID, STUDENT_AARIF_ID)).toBe(
      "current",
    );
  });

  it("classifies a linked sibling as other", async () => {
    expect(await familyContextService.classifyStudentAccess(DEMO_GUARDIAN_ACCOUNT_ID, STUDENT_MARIAM_ID)).toBe(
      "other",
    );
  });

  it("classifies an unlinked student as none", async () => {
    expect(await familyContextService.classifyStudentAccess(DEMO_GUARDIAN_ACCOUNT_ID, ZOYA_ID)).toBe("none");
    expect(await familyContextService.classifyStudentAccess(DEMO_GUARDIAN_ACCOUNT_ID, UNKNOWN_ID)).toBe("none");
  });

  it("classifies a null owner (admission record) as current", async () => {
    expect(await familyContextService.classifyStudentAccess(DEMO_GUARDIAN_ACCOUNT_ID, null)).toBe("current");
  });
});

describe("receipt page access scope", () => {
  it("renders the active child's receipt normally with no access panel", async () => {
    renderReceipt("RC-2026-0102");

    await waitFor(() => expect(screen.getByText("Faiz Aam Secondary School")).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText("Checking access…")).toBeNull());

    expect(screen.getByText("₹9,200")).toBeTruthy();
    expect(screen.getByText("Aarif Hussain · Class 8-A")).toBeTruthy();
    expect(screen.queryByText(/not available to this account/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });

  it("renders a sibling's receipt with the owning child and a working switch", async () => {
    const user = userEvent.setup();
    renderReceipt("RC-2026-0124");

    await waitFor(() => expect(screen.getByText("This receipt belongs to Mariam Hussain")).toBeTruthy(), {
      timeout: 3000,
    });

    // The owning child's name and class are shown on the sheet and the panel.
    expect(screen.getByText("Mariam Hussain · Class 8-A")).toBeTruthy();
    expect(screen.getByText(/is in Class 8-A/)).toBeTruthy();
    expect(screen.getByText("₹8,350")).toBeTruthy();
    expect(screen.queryByText(/not available to this account/i)).toBeNull();

    const switchButton = screen.getByRole("button", { name: "Switch to Mariam Hussain" });
    await user.click(switchButton);

    // The switch makes Mariam the active child: the owner reclassifies as
    // "current", the panel clears, the receipt stays, and the provider's
    // switch announcement is rendered for screen readers.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Switch to Mariam Hussain" })).toBeNull(), {
      timeout: 3000,
    });
    expect(screen.getByText("₹8,350")).toBeTruthy();
    expect(screen.getByText(/Now showing Mariam Hussain/)).toBeTruthy();
  });

  it("renders a neutral denial for a receipt owned by an unlinked child", async () => {
    sessionSet(FINANCE_SESSION_KEYS.invoices, [UNLINKED_INVOICE]);
    sessionSet(FINANCE_SESSION_KEYS.receipts, [UNLINKED_RECEIPT]);
    renderReceipt("RC-2026-0999");

    await waitFor(() => expect(screen.getByText("This record is not available to this account")).toBeTruthy(), {
      timeout: 3000,
    });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to fees" })).toBeTruthy();

    // No record details: no sheet, no reference, no amounts, no items, no
    // print action, no switch control.
    expect(screen.queryByText("Faiz Aam Secondary School")).toBeNull();
    expect(screen.queryByText(/RC-2026-0999/)).toBeNull();
    expect(screen.queryByText("₹6,000")).toBeNull();
    expect(screen.queryByText("Tuition fee")).toBeNull();
    expect(screen.queryByRole("button", { name: /Print receipt/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });

  it("renders a null-owned admission receipt as current", async () => {
    sessionSet(FINANCE_SESSION_KEYS.invoices, [ADMISSION_INVOICE]);
    sessionSet(FINANCE_SESSION_KEYS.receipts, [ADMISSION_RECEIPT]);
    renderReceipt("RC-2026-0888");

    await waitFor(() => expect(screen.getByText("Faiz Aam Secondary School")).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByText("Checking access…")).toBeNull());

    expect(screen.getByText("₹6,000")).toBeTruthy();
    // No owner to name, so the sheet falls back to the active child.
    expect(screen.getByText("Aarif Hussain · Class 8-A")).toBeTruthy();
    expect(screen.queryByText(/not available to this account/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch to/ })).toBeNull();
  });
});
