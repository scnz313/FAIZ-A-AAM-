import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setDemoNow } from "@/modules/demo/clock";
import { familyContextService, RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import { DEMO_CODE, identityService } from "@/modules/services/identity";
import { sessionKey, sessionRemove } from "@/modules/services/session";

const PINNED = new Date("2026-08-10T05:00:00.000Z");
const IDENTITY_SESSION_KEY = sessionKey("identity");
const FIRDOUS_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";

beforeEach(() => {
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(PINNED);
});

afterEach(() => {
  sessionRemove(IDENTITY_SESSION_KEY);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  setDemoNow(null);
});

describe("identity session and relationship context", () => {
  it("issues a session with stable account/person/guardian identifiers", async () => {
    const session = await identityService.verifyCode(DEMO_CODE);
    expect(session).toMatchObject({
      role: "guardian",
      name: "Firdous Ahmad",
      verified: true,
      accountId: FIRDOUS_ACCOUNT_ID,
      personId: "00000000-0000-4000-8000-000000000101",
      guardianId: "00000000-0000-4000-8000-000000001001",
    });
    expect(await identityService.session()).toMatchObject({ accountId: FIRDOUS_ACCOUNT_ID });
  });

  it("returns null for an expired session even though the record is kept", async () => {
    await identityService.verifyCode(DEMO_CODE);
    await identityService.expire();
    expect(await identityService.session()).toBeNull();
  });

  it("clear removes the session and resets the relationship context selection", async () => {
    await identityService.verifyCode(DEMO_CODE);
    const switched = await familyContextService.setActiveStudent(FIRDOUS_ACCOUNT_ID, MARIAM_ID);
    expect(switched.activeStudentId).toBe(MARIAM_ID);

    await identityService.clear();

    expect(await identityService.session()).toBeNull();
    /* The relationship store is reseeded from the graph, so the default
       first-linked child (Aarif) is selected again — no stale selection
       survives sign-out. */
    const context = await familyContextService.getContext(FIRDOUS_ACCOUNT_ID);
    expect(context.activeStudentId).toBe(AARIF_ID);
  });

  it("a cleared relationship store still serves the canonical two-child graph", async () => {
    await identityService.clear();
    const students = await familyContextService.listAccessibleStudentContexts(FIRDOUS_ACCOUNT_ID);
    expect(students.map((item) => item.student.id)).toEqual([AARIF_ID, MARIAM_ID]);
  });
});
