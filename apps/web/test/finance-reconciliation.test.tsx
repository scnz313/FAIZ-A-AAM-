import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adapterCall: vi.fn(),
  routerRefresh: vi.fn(),
}));

vi.mock("@/modules/services/adapter-client", () => ({
  adapterCall: mocks.adapterCall,
  clientAdapterMode: () => "supabase",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.routerRefresh }),
}));

vi.mock("@/components/staff/StaffContextProvider", () => ({
  useStaffContext: () => ({
    summary: {
      role: "finance_officer",
      roles: ["finance_officer"],
      displayName: "Fictional Finance Officer",
    },
  }),
}));

import { ReconciliationRun } from "@/app/staff/finance/reconciliation/ReconciliationRun";
import { mapServerReconciliationRun, type ServerReconciliationProjectionRow } from "@/modules/services/finance-server-map";

const EXCEPTION_ID = "00000000-0000-4000-8000-000000000901";

function projection(status: "open" | "resolved"): ServerReconciliationProjectionRow {
  return {
    id: "00000000-0000-4000-8000-000000000900",
    reference: "REC-2026-0901",
    run_at: "2026-08-05T09:30:00Z",
    status: "completed",
    summary: { matched: 3, discrepancies: status === "open" ? 1 : 0, pending: 0 },
    created_by_account_id: "00000000-0000-4000-8000-000000000203",
    reconciliation_evidence: [
      {
        id: "00000000-0000-4000-8000-000000000902",
        reference: "RCE-2026-0901",
        provider_txn_id: "provider-payment-901",
        amount_paise: 125000,
        state: "captured",
      },
    ],
    reconciliation_exceptions: [
      {
        id: EXCEPTION_ID,
        evidence_id: "00000000-0000-4000-8000-000000000902",
        kind: "gateway_only_or_amount_mismatch",
        detail: { kind: "gateway-only", note: "Captured by the sandbox but absent from the ledger." },
        status,
        resolution_reason: status === "resolved" ? "Posted after checking the provider evidence." : null,
        version: status === "resolved" ? 5 : 4,
        created_at: "2026-08-05T09:31:00Z",
        resolved_at: status === "resolved" ? "2026-08-05T09:35:00Z" : null,
        resolved_by_account_id: status === "resolved" ? "00000000-0000-4000-8000-000000000203" : null,
      },
    ],
  };
}

describe("ReconciliationRun authoritative resolve refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reloads the run after resolving and refreshes the server projection", async () => {
    const openProjection = projection("open");
    const resolvedProjection = projection("resolved");
    mocks.adapterCall
      .mockResolvedValueOnce({ ok: true, value: [openProjection], errors: [] })
      .mockResolvedValueOnce({ ok: true, value: {}, errors: [] })
      .mockResolvedValueOnce({ ok: true, value: [resolvedProjection], errors: [] });

    const user = userEvent.setup();
    render(
      <ReconciliationRun
        mode="supabase"
        initialRuns={[mapServerReconciliationRun(openProjection)]}
        matchedCount={3}
        discrepancyCount={1}
        pendingCount={0}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Resolution reason for provider-payment-901" }),
      "Posted after checking the provider evidence.",
    );
    await user.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(screen.getByText("resolved")).toBeInTheDocument());
    expect(screen.getByText("Resolution: Posted after checking the provider evidence.")).toBeInTheDocument();
    expect(mocks.adapterCall).toHaveBeenNthCalledWith(1, "finance.listReconciliationRuns");
    expect(mocks.adapterCall).toHaveBeenNthCalledWith(2, "finance.resolveReconciliation", {
      exceptionId: EXCEPTION_ID,
      resolutionReason: "Posted after checking the provider evidence.",
      expectedVersion: 4,
      idempotencyKey: `recon:REC-2026-0901:${EXCEPTION_ID}`,
    });
    expect(mocks.adapterCall).toHaveBeenNthCalledWith(3, "finance.listReconciliationRuns");
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });
});
