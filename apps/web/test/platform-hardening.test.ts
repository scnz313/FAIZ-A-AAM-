// @vitest-environment node
/**
 * S4 platform hardening — cross-service integration proofs.
 *
 * Each test spans two hardened facades to prove the guarantee holds across
 * the service boundary (not just inside one store):
 * 1. Guardian-link revocation immediately denies the documents bundle.
 * 2. Link revocation retries emit exactly one revocation delivery.
 * 3. Content publish retries emit exactly one publication delivery.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import {
  CONTENT_INTENTS_SESSION_KEY,
  CONTENT_SESSION_KEY,
  contentService,
  type ContentActor,
} from "@/modules/services/content";
import { documentsService } from "@/modules/services/documents";
import {
  familyContextService,
  RELATIONSHIPS_SESSION_KEY,
} from "@/modules/services/family-context";
import { clearOutboxSession, listOutboxEvents } from "@/modules/services/outbox";
import { sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";

const DEMO_PUBLISHER_ACTOR: ContentActor = {
  accountId: "demo-content-publisher",
  displayName: "Demo publisher",
  role: "content_publisher",
};

function clearAll(): void {
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  sessionRemove(CONTENT_SESSION_KEY);
  sessionRemove(CONTENT_INTENTS_SESSION_KEY);
  clearOutboxSession();
}

beforeEach(() => {
  clearAll();
  setDemoNow(PINNED);
});

afterEach(() => {
  clearAll();
  setDemoNow(null);
});

describe("platform hardening — revocation immediacy across services", () => {
  it("revoking a guardian link immediately denies that child's documents bundle", async () => {
    const request = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );
    const approved = await familyContextService.approvePendingLinkRequest(request.id);
    expect(approved.approvedLinkId).not.toBeNull();

    /* While the link is active the bundle is served. */
    const bundle = await documentsService.listForStudent(FIRDOUS_ACCOUNT_ID, ZOYA_ID);
    expect(bundle.studentId).toBe(ZOYA_ID);

    await familyContextService.revokeLink(approved.approvedLinkId!);

    /* After revocation the same read is denied — no stale projection survives. */
    await expect(documentsService.listForStudent(FIRDOUS_ACCOUNT_ID, ZOYA_ID)).rejects.toThrow(
      /not accessible/,
    );
  });

  it("revoking the same link twice emits exactly one revocation delivery", async () => {
    const request = await familyContextService.createPendingLinkRequest(
      FIRDOUS_ACCOUNT_ID,
      "Firdous Ahmad",
      "STU-2026-0903",
      "Parent",
    );
    const approved = await familyContextService.approvePendingLinkRequest(request.id);

    await familyContextService.revokeLink(approved.approvedLinkId!);
    await familyContextService.revokeLink(approved.approvedLinkId!);

    expect(listOutboxEvents().filter((event) => event.kind === "link.revoked")).toHaveLength(1);
  });
});

describe("platform hardening — retry safety across services", () => {
  it("replaying a content publish emits exactly one publication delivery", async () => {
    const created = await contentService.createNotice({
      title: "Single delivery notice",
      category: "General",
      body: ["Body."],
      audience: "public",
      publishNote: "Publish",
    });
    await contentService.requestReview(created.slug);
    const approved = await contentService.approveVersion(created.slug, { actor: DEMO_PUBLISHER_ACTOR });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("approval failed");
    const version = approved.value.version;

    const input = {
      actor: DEMO_PUBLISHER_ACTOR,
      expectedVersion: version,
      note: "Publish",
      idempotencyKey: "hardening-test:publish-once",
    };
    const first = await contentService.publishVersionV2(created.slug, input);
    expect(first.ok).toBe(true);
    const replay = await contentService.publishVersionV2(created.slug, input);
    expect(replay.ok).toBe(true);
    if (!replay.ok) throw new Error("replay failed");
    expect(replay.replayed).toBe(true);

    expect(
      listOutboxEvents().filter((event) => event.kind === "content.published"),
    ).toHaveLength(1);
  });
});
