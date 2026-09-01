"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { FamilyPortalContext } from "@fass/contracts";

import {
  DEMO_GUARDIAN_ACCOUNT_ID,
  familyContextService,
  type AccessibleStudentContext,
} from "@/modules/services/family-context";
import { identityService } from "@/modules/services/identity";
import { clientAdapterMode } from "@/modules/services/adapter-client";

type FamilyContextStatus = "loading" | "ready" | "error";

export type FamilyContextValue = {
  status: FamilyContextStatus;
  errorMessage: string | null;
  /** The canonical active-child context; null until the first load resolves. */
  context: FamilyPortalContext | null;
  /** Every child linked through an active link, with placement and year. */
  students: AccessibleStudentContext[];
  /** The child currently selected; null while loading or on error. */
  activeStudent: AccessibleStudentContext | null;
  guardianName: string | null;
  switching: boolean;
  switchError: string | null;
  /** Screen-reader announcement for the last completed child switch. */
  announcement: string | null;
  switchStudent: (studentId: string) => Promise<void>;
  retry: () => void;
  /** Server-seeded document metadata for the active child; never a file URL. */
  documentMetadata: Array<{ ref: string; category: string; filename: string; processingState: string; mimeType: string; sizeBytes: number }>;
};

export type FamilyContextInitialState = {
  context: FamilyPortalContext;
  students: AccessibleStudentContext[];
  guardianName: string;
  documentMetadata?: FamilyContextValue["documentMetadata"];
};

const FamilyContextContext = createContext<FamilyContextValue | null>(null);

/**
 * Family portal context spine (I0/I1): loads the account's accessible
 * students and the persisted active-child selection through the relationship
 * service, and owns the switch behavior. A failed switch preserves the
 * previous selection and reports a recoverable error. The demo falls back to
 * the seeded guardian account when no sign-in session exists; the backend
 * phase replaces that fallback with server authorization.
 */
export function FamilyContextProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: FamilyContextInitialState;
}) {
  const [status, setStatus] = useState<FamilyContextStatus>(initialState ? "ready" : "loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [context, setContext] = useState<FamilyPortalContext | null>(initialState?.context ?? null);
  const [students, setStudents] = useState<AccessibleStudentContext[]>(initialState?.students ?? []);
  const [guardianName, setGuardianName] = useState<string | null>(initialState?.guardianName ?? null);
  const [documentMetadata] = useState<FamilyContextValue["documentMetadata"]>(initialState?.documentMetadata ?? []);
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
          const [nextContext, nextStudents, summary] = await Promise.all([
            familyContextService.getContext("server"),
            familyContextService.listAccessibleStudentContexts("server"),
            familyContextService.getAccountSummary("server"),
          ]);
          if (cancelled) return;
          setContext(nextContext);
          setStudents(nextStudents);
          setGuardianName(summary.displayName);
          setStatus("ready");
          return;
        }
        const session = await identityService.session();
        const resolvedAccountId =
          session !== null && session.role === "guardian" ? session.accountId : DEMO_GUARDIAN_ACCOUNT_ID;
        const [nextContext, nextStudents, summary] = await Promise.all([
          familyContextService.getContext(resolvedAccountId),
          familyContextService.listAccessibleStudentContexts(resolvedAccountId),
          familyContextService.getAccountSummary(resolvedAccountId),
        ]);
        if (cancelled) return;
        setContext(nextContext);
        setStudents(nextStudents);
        setGuardianName(summary.displayName);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error ? error.message : "The demo family context could not be loaded.",
        );
        setStatus("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [initialState, reloadKey]);

  const switchStudent = useCallback(
    async (studentId: string) => {
      if (context === null || studentId === context.activeStudentId) return;
      setSwitching(true);
      setSwitchError(null);
      /* Fail closed: clear the outgoing child's context immediately so no
         stale sensitive rows remain visible while the switch resolves. The
         previous authorized context is restored only if the switch fails. */
      const previousContext = context;
      setContext(null);
      try {
        const next = await familyContextService.setActiveStudent(previousContext.accountId, studentId);
        setContext(next);
        const selected = students.find((item) => item.student.id === studentId);
        if (selected !== undefined) {
          setAnnouncement(
            `Now showing ${selected.student.displayName}, ${selected.gradeSection.gradeLabel}-${selected.gradeSection.sectionLabel}, ${selected.academicYear.label}.`,
          );
        }
      } catch (error) {
        /* Keep the previous selection visible; the switch never half-applies. */
        setContext(previousContext);
        setSwitchError(
          error instanceof Error
            ? error.message
            : "Switching children failed — the previous selection is unchanged.",
        );
      } finally {
        setSwitching(false);
      }
    },
    [context, students],
  );

  const retry = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const activeStudent =
    context === null ? null : students.find((item) => item.student.id === context.activeStudentId) ?? null;

  const value = useMemo<FamilyContextValue>(
    () => ({
      status,
      errorMessage,
      context,
      students,
      activeStudent,
      guardianName,
      switching,
      switchError,
      announcement,
      switchStudent,
      retry,
      documentMetadata,
    }),
    [
      status,
      errorMessage,
      context,
      students,
      activeStudent,
      guardianName,
      switching,
      switchError,
      announcement,
      switchStudent,
      retry,
      documentMetadata,
    ],
  );

  return <FamilyContextContext.Provider value={value}>{children}</FamilyContextContext.Provider>;
}

export function useFamilyContext(): FamilyContextValue {
  const value = useContext(FamilyContextContext);
  if (value === null) {
    throw new Error("useFamilyContext must be used inside FamilyContextProvider.");
  }
  return value;
}
