/**
 * Typed identity-service boundary: demo session, sign-in/verification,
 * recovery, guardian/student linking, and session state. The current
 * implementation is a deterministic demo adapter; the backend phase replaces
 * it behind the same signatures (see UI-COMPLETION-PLAN.md §4 and §5.1).
 *
 * Honesty contract: this demo never claims real security. It accepts one
 * fixed demo account, shows its codes on screen, and stores the resulting
 * session in the browser session store. Nothing is sent anywhere and no
 * data is protected. Staff roles exist in the type contract for the future
 * backend, but the demo adapter never issues one — staff pages stay
 * publicly reachable demo shells with their existing demo banners.
 *
 * Determinism: references come from session counters (seeded like the
 * support service) and timestamps from the injected demo clock — never the
 * wall clock or Math.random().
 */

import { demoNowIso } from "@/modules/demo/clock";
import { sessionGet, sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";
import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  RELATIONSHIPS_SESSION_KEY,
  familyContextService,
} from "@/modules/services/family-context";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DemoRole = "visitor" | "guardian" | "staff";

export type DemoSession = {
  role: DemoRole;
  name: string;
  verified: boolean;
  mfaRequired: boolean;
  /** Stable demo identifiers — the session maps to one account/person. */
  accountId: string;
  personId: string;
  /** Present when the session has an active guardian workspace. */
  guardianId?: string;
};

export type SignInResult =
  | { ok: true; requiresVerification: boolean }
  | { ok: false; reason: string };

/**
 * Recovery result. The real adapter returns only `{ ref }` — the reset code
 * goes by SMS/email. The demo adapter returns it inline so the UI can show
 * it, which is exactly what an honest UI-only demo must do.
 */
export type RecoveryResult = { ref: string; demoResetCode: string };

export interface IdentityService {
  /** Demo account: +91 90000 00000 with any password of 6+ characters. */
  signIn(phoneOrEmail: string, password: string): Promise<SignInResult>;
  /** Throws `DemoIdentityError` when the code is wrong. */
  verifyCode(code: string): Promise<DemoSession>;
  startRecovery(identifier: string): Promise<RecoveryResult>;
  /** Delegates to the unified relationship request store (plan.md Phase 3). */
  requestLink(guardianName: string, childAdmissionRef: string, relation: string): Promise<{ ref: string }>;
  session(): Promise<DemoSession | null>;
  /** Marks the session expired (inactivity). The session record is kept. */
  expire(): Promise<void>;
  /** Removes the stored session and resets all identity state. */
  clear(): Promise<void>;
}

/** Error thrown by the demo adapter for an invalid verification code. */
export class DemoIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoIdentityError";
  }
}

/* ------------------------------------------------------------------ */
/* Demo fixtures (fictional — no real accounts exist)                  */
/* ------------------------------------------------------------------ */

/** The one demo guardian phone accepted by signIn (normalized digits). */
export const DEMO_PHONE = "+91 90000 00000";
const DEMO_PHONE_DIGITS = DEMO_PHONE.replace(/\D/g, "");

/** Fixed code shown on the verify screen. */
export const DEMO_CODE = "482913";

/** Fixed code shown on the recovery screen. */
export const DEMO_RESET_CODE = "749210";

/** Session created by verifyCode — matches the portal's demo guardian. */
const DEMO_GUARDIAN_SESSION: DemoSession = {
  role: "guardian",
  name: "Firdous Ahmad",
  verified: true,
  mfaRequired: false,
  accountId: "00000000-0000-4000-8000-000000000201",
  personId: "00000000-0000-4000-8000-000000000101",
  guardianId: "00000000-0000-4000-8000-000000001001",
};

/** Honest copy for the "Demo staff access" note on the sign-in page. */
export const STAFF_DEMO_NOTE =
  "Staff workspaces are demo shells — staff accounts and permissions arrive with the backend.";

/* ------------------------------------------------------------------ */
/* Demo adapter                                                        */
/* ------------------------------------------------------------------ */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Session-store shape: the demo session, the expired flag, and the recovery counter. */
type IdentityStore = {
  session: DemoSession | null;
  sessionCreatedAtIso: string | null;
  expired: boolean;
  /** Next free recovery-ref suffix — seeded 101, after the fixture refs. */
  recoveryCounter: number;
};

const IDENTITY_SESSION_KEY = sessionKey("identity");

/** Read the session store, seeding it on first access. */
function readStore(): IdentityStore {
  const existing = sessionGet<IdentityStore>(IDENTITY_SESSION_KEY);
  if (existing !== null) return existing;
  const seeded: IdentityStore = {
    session: null,
    sessionCreatedAtIso: null,
    expired: false,
    recoveryCounter: 101,
  };
  sessionSet(IDENTITY_SESSION_KEY, seeded);
  return seeded;
}

function writeStore(store: IdentityStore): void {
  sessionSet(IDENTITY_SESSION_KEY, store);
}

function recoveryRef(counter: number): string {
  return `RC-2026-${String(counter).padStart(4, "0")}`;
}

/** Copy so callers can never mutate the stored session. */
function copySession(session: DemoSession): DemoSession {
  return { ...session };
}

/**
 * Deterministic demo adapter. The session survives route changes inside the
 * browser session (sessionKey("identity")), so a verified sign-in is always
 * returned by `session()` afterwards — never implied by a local click.
 * Nothing here is secure; the real backend replaces this wholesale.
 */
export function createDemoIdentityService(latencyMs = 200): IdentityService {
  return {
    async signIn(phoneOrEmail, password) {
      await sleep(latencyMs);
      const digits = phoneOrEmail.replace(/\D/g, "");
      if (digits === DEMO_PHONE_DIGITS && password.length >= 6) {
        return { ok: true, requiresVerification: true };
      }
      return { ok: false, reason: "Check the phone number and password." };
    },

    async verifyCode(code) {
      await sleep(latencyMs);
      if (code.trim() !== DEMO_CODE) {
        throw new DemoIdentityError("That code is not right — check it and try again.");
      }
      const store = readStore();
      store.session = copySession(DEMO_GUARDIAN_SESSION);
      store.sessionCreatedAtIso = demoNowIso();
      store.expired = false;
      writeStore(store);
      return copySession(DEMO_GUARDIAN_SESSION);
    },

    async startRecovery(identifier) {
      await sleep(latencyMs);
      const store = readStore();
      const ref = recoveryRef(store.recoveryCounter);
      store.recoveryCounter += 1;
      writeStore(store);
      void identifier; // the demo accepts any identifier; validation is UI-side
      return { ref, demoResetCode: DEMO_RESET_CODE };
    },

    async requestLink(guardianName, childAdmissionRef, relation) {
      await sleep(latencyMs);
      /* One request store (plan.md Phase 3): the relationship service owns
         pending requests so the staff link-request screen can decide them. */
      const session = await this.session();
      const accountId =
        session !== null && session.role === "guardian" ? session.accountId : DEMO_GUARDIAN_ACCOUNT_ID;
      const request = await familyContextService.createPendingLinkRequest(
        accountId,
        guardianName,
        childAdmissionRef,
        relation,
      );
      return { ref: request.ref };
    },

    async session() {
      await sleep(latencyMs);
      const store = readStore();
      /* An expired session is a signed-out session, even though the record is kept. */
      if (store.expired) return null;
      return store.session ? copySession(store.session) : null;
    },

    async expire() {
      await sleep(latencyMs);
      const store = readStore();
      store.expired = true;
      writeStore(store);
    },

    async clear() {
      await sleep(latencyMs);
      sessionRemove(IDENTITY_SESSION_KEY);
      /* Signing out also resets the relationship/context demo state so the
         next sign-in starts from the seeded graph, not a previous session's
         active-child or workspace selection. */
      sessionRemove(RELATIONSHIPS_SESSION_KEY);
    },
  };
}

/** Default singleton consumed by the identity views. */
export const identityService: IdentityService = createDemoIdentityService();
