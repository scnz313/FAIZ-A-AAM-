// @vitest-environment jsdom
/**
 * Deliveries workspace: status filters, retry/requeue visibility rules
 * (only failed deliveries / failed events), reason validation, and the
 * manual worker run — all against a mocked service.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  retry: vi.fn(),
  requeueEvent: vi.fn(),
  mode: vi.fn<() => "demo" | "supabase">(() => "supabase"),
}));

vi.mock("@/modules/services/adapter-client", () => ({ clientAdapterMode: () => mocks.mode() }));
vi.mock("@/modules/services/deliveries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/services/deliveries")>();
  return {
    ...actual,
    deliveriesService: {
      list: mocks.list,
      retry: mocks.retry,
      requeueEvent: mocks.requeueEvent,
    },
  };
});

import DeliveriesWorkspace from "@/app/staff/deliveries/DeliveriesWorkspace";
import type { DeliveriesBoard } from "@/modules/services/deliveries";

const BOARD: DeliveriesBoard = {
  summary: { pending: 1, processing: 0, delivered: 5, failed: 1, deliveriesFailedPermanent: 1 },
  events: [
    {
      eventId: "evt-failed",
      eventKey: "email.notice_published:NTC-2026-0001:v2",
      kind: "email.deliver",
      targetType: "notice",
      targetReference: "NTC-2026-0001",
      status: "failed",
      attempts: 10,
      maxAttempts: 10,
      nextAttemptAt: null,
      lastError: "Permanent: sender rejected",
      createdAt: "2026-09-10T08:00:00.000Z",
      deliveredAt: null,
      deliveries: [
        {
          deliveryId: "dlv-failed",
          recipientMasked: "fi***@example.test",
          channel: "email",
          status: "failed",
          failureClass: "permanent",
          attempts: 10,
          lastError: "Mailbox unavailable",
          providerMessageId: null,
          updatedAt: "2026-09-10T08:10:00.000Z",
        },
      ],
      providerJobs: [],
    },
    {
      eventId: "evt-pending",
      eventKey: "email.offer:ADM-2026-0003",
      kind: "email.deliver",
      targetType: "admission_application",
      targetReference: "ADM-2026-0003",
      status: "pending",
      attempts: 0,
      maxAttempts: 10,
      nextAttemptAt: "2026-09-15T10:00:00.000Z",
      lastError: null,
      createdAt: "2026-09-15T09:00:00.000Z",
      deliveredAt: null,
      deliveries: [
        {
          deliveryId: "dlv-pending",
          recipientMasked: "pa***@example.test",
          channel: "email",
          status: "pending",
          failureClass: null,
          attempts: 0,
          lastError: null,
          providerMessageId: null,
          updatedAt: "2026-09-15T09:00:00.000Z",
        },
      ],
      providerJobs: [],
    },
  ],
};

beforeEach(() => {
  mocks.list.mockReset().mockResolvedValue(BOARD);
  mocks.retry.mockReset().mockResolvedValue({ applied: true });
  mocks.requeueEvent.mockReset().mockResolvedValue({ applied: true });
  mocks.mode.mockReset().mockReturnValue("supabase");
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ worker: { lastRunAt: "2026-09-15T10:00:00.000Z" } }), { status: 200 })));
});

describe("DeliveriesWorkspace", () => {
  it("renders the summary facts, events and last worker run", async () => {
    render(<DeliveriesWorkspace />);
    await waitFor(() => expect(screen.getAllByText(/NTC-2026-0001/)[0]).toBeTruthy());
    const summary = screen.getByLabelText("Delivery queue summary");
    expect(summary.textContent).toContain("Pending");
    expect(summary.textContent).toContain("Failed deliveries");
    await waitFor(() => expect(screen.getByText(/Last worker run/).textContent).toContain("ago"));
  });

  it("offers retry only for the failed delivery and requeue only for the failed event", async () => {
    render(<DeliveriesWorkspace />);
    await waitFor(() => expect(screen.getByText("Retry · fi***@example.test")).toBeTruthy());
    expect(screen.queryByText("Retry · pa***@example.test")).toBeNull();
    const rows = screen.getAllByRole("row");
    expect(rows.some((row) => row.textContent?.includes("ADM-2026-0003") && row.textContent?.includes("No action needed"))).toBe(true);
  });

  it("filters events through the service by status", async () => {
    mocks.list.mockImplementation(async ({ status }: { status: string | null }) => ({
      ...BOARD,
      events: status === null ? BOARD.events : BOARD.events.filter((event) => event.status === status),
    }));
    render(<DeliveriesWorkspace />);
    await waitFor(() => expect(screen.getAllByText(/ADM-2026-0003/)[0]).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(screen.queryAllByText(/ADM-2026-0003/)).toHaveLength(0));
    expect(screen.getAllByText(/NTC-2026-0001/)[0]).toBeTruthy();
  });

  it("requires a reason before retrying a delivery", async () => {
    render(<DeliveriesWorkspace />);
    await waitFor(() => expect(screen.getByText("Retry · fi***@example.test")).toBeTruthy());
    await userEvent.click(screen.getByText("Retry · fi***@example.test"));
    await userEvent.click(screen.getByRole("button", { name: "Retry delivery" }));
    expect(screen.getByText("Enter a reason of at least 3 characters.")).toBeTruthy();
    expect(mocks.retry).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Reason"), "sender was misconfigured");
    await userEvent.click(screen.getByRole("button", { name: "Retry delivery" }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith({ deliveryId: "dlv-failed", reason: "sender was misconfigured" }));
    expect(screen.getByText(/queued for another attempt/)).toBeTruthy();
  });

  it("runs the worker and announces claimed/delivered/failed counts", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/outbox/run") {
        return new Response(JSON.stringify({ ok: true, claimed: 4, delivered: 3, transientFailed: 1, permanentFailed: 0 }), { status: 200 });
      }
      return new Response(JSON.stringify({ worker: { lastRunAt: null } }), { status: 200 });
    }));
    render(<DeliveriesWorkspace />);
    await waitFor(() => expect(screen.getAllByText(/NTC-2026-0001/)[0]).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Run worker now" }));
    await waitFor(() => expect(screen.getByText("Worker run complete · claimed 4, delivered 3, failed 1.")).toBeTruthy());
  });

  it("surfaces worker run failures without losing the board", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/outbox/run") {
        return new Response(JSON.stringify({ ok: false, error: "Administrator role required." }), { status: 403 });
      }
      return new Response(JSON.stringify({ worker: { lastRunAt: null } }), { status: 200 });
    }));
    render(<DeliveriesWorkspace />);
    await waitFor(() => expect(screen.getAllByText(/NTC-2026-0001/)[0]).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Run worker now" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Administrator role required."));
    expect(screen.getAllByText(/NTC-2026-0001/)[0]).toBeTruthy();
  });
});
