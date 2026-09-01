"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { RoleGrant } from "@fass/contracts";

import {
  DEMO_STAFF_IDENTITIES,
  type DemoStaffIdentity,
} from "@/modules/services/staff-authorization";
import { DEMO_STAFF_ACCOUNT_ID, staffContextService, type StaffWorkspaceSummary } from "@/modules/services/staff-context";
import { identityService } from "@/modules/services/identity";
import { clientAdapterMode } from "@/modules/services/adapter-client";
import { sessionGet, sessionKey, sessionSet } from "@/modules/services/session";

type StaffContextStatus = "loading" | "ready" | "error";

/** The demo identity selection persists within the session (like the active workspace). */
const STAFF_IDENTITY_KEY = sessionKey("staff-identity");

/** Exported so tests can clear the demo session deterministically. */
export const STAFF_SESSION_KEYS = { identity: STAFF_IDENTITY_KEY } as const;

export type StaffContextValue = {
  status: StaffContextStatus;
  errorMessage: string | null;
  /** Display summary of the active workspace; null until the first load. */
  summary: StaffWorkspaceSummary | null;
  /** Every staff role grant for the account, with role names. */
  workspaces: RoleGrant[];
  /** The demo identity account currently in use. */
  identityId: string | null;
  /** Fictional staff accounts the demo shell can switch between. */
  demoIdentities: ReadonlyArray<DemoStaffIdentity>;
  switching: boolean;
  switchError: string | null;
  announcement: string | null;
  switchWorkspace: (roleGrantId: string) => Promise<void>;
  /** Stand-in for staff sign-in: switch to another demo staff account. */
  switchIdentity: (accountId: string) => Promise<void>;
  retry: () => void;
};

export type StaffContextInitialState = {
  summary: StaffWorkspaceSummary;
  workspaces: RoleGrant[];
  identityId: string;
};

const StaffContextContext = createContext<StaffContextValue | null>(null);

/**
 * Staff workspace context spine (I0): loads the demo staff account's granted
 * workspaces and the persisted active role through the staff context
 * service. Multi-role accounts get a workspace switch; a failed switch keeps
 * the previous workspace. The backend phase replaces the demo account
 * fallback with server authorization and session identity.
 */
export function StaffContextProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: StaffContextInitialState;
}) {
  const [status, setStatus] = useState<StaffContextStatus>(initialState ? "ready" : "loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<StaffWorkspaceSummary | null>(initialState?.summary ?? null);
  const [workspaces, setWorkspaces] = useState<RoleGrant[]>(initialState?.workspaces ?? []);
  const [identityId, setIdentityId] = useState<string | null>(initialState?.identityId ?? null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (initialState !== undefined && reloadKey === 0) return;
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);
    setSwitchError(null);

    async function load(): Promise<void> {
      try {
        if (clientAdapterMode() === "supabase") {
          const [nextSummary, nextWorkspaces] = await Promise.all([
            staffContextService.getWorkspaceSummary("server"),
            staffContextService.listGrantedWorkspaces("server"),
          ]);
          if (cancelled) return;
          setSummary(nextSummary);
          setWorkspaces(nextWorkspaces);
          setIdentityId(nextSummary.accountId);
          setStatus("ready");
          return;
        }
        /* Staff sign-in does not exist in the demo — the seeded staff account
           stands in until the identity backend issues staff sessions. The
           demo identity picker persists its selection for the session. */
        const session = await identityService.session();
        const storedIdentity = sessionGet<string>(STAFF_IDENTITY_KEY);
        const storedValid =
          storedIdentity !== null && DEMO_STAFF_IDENTITIES.some((identity) => identity.accountId === storedIdentity);
        const resolvedAccountId =
          session !== null && session.role === "staff"
            ? session.accountId
            : storedValid
              ? (storedIdentity as string)
              : DEMO_STAFF_ACCOUNT_ID;
        const [nextSummary, nextWorkspaces] = await Promise.all([
          staffContextService.getWorkspaceSummary(resolvedAccountId),
          staffContextService.listGrantedWorkspaces(resolvedAccountId),
        ]);
        if (cancelled) return;
        setSummary(nextSummary);
        setWorkspaces(nextWorkspaces);
        setIdentityId(resolvedAccountId);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error ? error.message : "The demo staff workspace could not be loaded.",
        );
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialState, reloadKey]);

  const switchWorkspace = useCallback(
    async (roleGrantId: string) => {
      if (summary === null || roleGrantId === undefined) return;
      /* Profile accounts hold the exact profile bundle — granular workspace
         switching is a legacy-account-only compatibility path. */
      if (summary.profileCode !== null) {
        setSwitchError("Workspace switching is not available for access-profile accounts.");
        return;
      }
      if (workspaces.some((workspace) => workspace.id === roleGrantId && workspace.role === summary.role)) return;
      setSwitching(true);
      setSwitchError(null);
      try {
        await staffContextService.setActiveWorkspace(summary.accountId, roleGrantId);
        const nextSummary = await staffContextService.getWorkspaceSummary(summary.accountId);
        setSummary(nextSummary);
        setAnnouncement(`Workspace switched to ${nextSummary.roleLabel}.`);
      } catch (error) {
        setSwitchError(
          error instanceof Error
            ? error.message
            : "Switching workspace failed — the previous workspace is unchanged.",
        );
      } finally {
        setSwitching(false);
      }
    },
    [summary, workspaces],
  );

  const switchIdentity = useCallback(
    async (accountId: string) => {
      if (accountId === identityId) return;
      if (clientAdapterMode() === "supabase") {
        setSwitchError("Staff identity switching is available only in the demo adapter.");
        return;
      }
      setSwitching(true);
      setSwitchError(null);
      try {
        const [nextSummary, nextWorkspaces] = await Promise.all([
          staffContextService.getWorkspaceSummary(accountId),
          staffContextService.listGrantedWorkspaces(accountId),
        ]);
        setSummary(nextSummary);
        setWorkspaces(nextWorkspaces);
        setIdentityId(accountId);
        sessionSet(STAFF_IDENTITY_KEY, accountId);
        const identity = DEMO_STAFF_IDENTITIES.find((candidate) => candidate.accountId === accountId);
        setAnnouncement(`Demo identity switched to ${identity?.displayName ?? "staff member"}.`);
      } catch (error) {
        setSwitchError(
          error instanceof Error ? error.message : "Switching identity failed — the previous account is unchanged.",
        );
      } finally {
        setSwitching(false);
      }
    },
    [identityId],
  );

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const value = useMemo<StaffContextValue>(
    () => ({
      status,
      errorMessage,
      summary,
      workspaces,
      identityId,
      demoIdentities: clientAdapterMode() === "supabase" ? [] : DEMO_STAFF_IDENTITIES,
      switching,
      switchError,
      announcement,
      switchWorkspace,
      switchIdentity,
      retry,
    }),
    [
      status,
      errorMessage,
      summary,
      workspaces,
      identityId,
      switching,
      switchError,
      announcement,
      switchWorkspace,
      switchIdentity,
      retry,
    ],
  );

  return <StaffContextContext.Provider value={value}>{children}</StaffContextContext.Provider>;
}

export function useStaffContext(): StaffContextValue {
  const value = useContext(StaffContextContext);
  if (value === null) {
    throw new Error("useStaffContext must be used inside StaffContextProvider.");
  }
  return value;
}
