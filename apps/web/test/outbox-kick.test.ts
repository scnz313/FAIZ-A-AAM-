// @vitest-environment node
/**
 * scheduleOutboxKick: debounced post-response worker drain. Demo mode is a
 * no-op; repeated kicks within five seconds collapse to one `after()` task;
 * worker failures are swallowed into providerLog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  dataAdapter: vi.fn(() => "supabase"),
  createSupabaseAdminClient: vi.fn(() => ({ admin: true })),
  processOutboxBatch: vi.fn().mockResolvedValue({ claimed: 0, delivered: 0 }),
  providerLog: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/env", () => ({ dataAdapter: mocks.dataAdapter }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/supabase/outbox-worker", () => ({ processOutboxBatch: mocks.processOutboxBatch }));
vi.mock("@/lib/observability/log", () => ({ providerLog: mocks.providerLog }));

async function loadKick() {
  vi.resetModules();
  const kickModule = await import("@/lib/supabase/outbox-kick");
  return kickModule.scheduleOutboxKick;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.dataAdapter.mockReturnValue("supabase");
  mocks.processOutboxBatch.mockResolvedValue({ claimed: 0, delivered: 0 });
});

afterEach(() => vi.useRealTimers());

describe("scheduleOutboxKick", () => {
  it("is a no-op for the demo adapter", async () => {
    mocks.dataAdapter.mockReturnValue("demo");
    const schedule = await loadKick();

    schedule("test.write");

    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("schedules a post-response batch and debounces repeat kicks", async () => {
    const schedule = await loadKick();

    schedule("first.write");
    schedule("second.write");
    expect(mocks.after).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4_999);
    schedule("third.write");
    expect(mocks.after).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    schedule("fourth.write");
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });

  it("runs a size-10 batch through the admin client", async () => {
    const schedule = await loadKick();
    schedule("adapter:results.publish");

    const task = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await task();

    expect(mocks.processOutboxBatch).toHaveBeenCalledWith({
      admin: { admin: true },
      batchSize: 10,
    });
    expect(mocks.providerLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "outbox.kick", outcome: "succeeded" }),
    );
  });

  it("swallows worker failures into providerLog", async () => {
    mocks.processOutboxBatch.mockRejectedValue(new Error("claim failed"));
    const schedule = await loadKick();
    schedule("adapter:x");

    const task = mocks.after.mock.calls[0]?.[0] as () => Promise<void>;
    await expect(task()).resolves.toBeUndefined();
    expect(mocks.providerLog).toHaveBeenCalledWith(
      expect.objectContaining({ event: "outbox.kick", outcome: "failed" }),
    );
  });
});
