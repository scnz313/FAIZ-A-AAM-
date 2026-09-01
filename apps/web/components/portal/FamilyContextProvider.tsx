"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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

/**
 * Shared dirty-form registry: child-scoped forms register a dirty check
 * before a switch. If any form is dirty, the switch is blocked with a
 * recoverable save/discard prompt.
 */
type DirtyFormEntry = { id: string; check: () => boolean };

/** Monotonically increasing generation counter — child consumers use this
 * as a remount key so every child-scoped component resets on switch. */
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
  /** Monotonically increasing generation — remount key for child consumers. */
  generation: number;
  /** Register a dirty-form check; returns an unregister function. */
  registerDirtyForm: (id: string, check: () => boolean) => () => void;
  /** True when any registered form is dirty. */
  isDirty: boolean;
};

export type FamilyContextInitialState = {
  context: FamilyPortalContext;
  students: AccessibleStudentContext[];
  guardianName: string;
  documentMetadata?: FamilyContextValue["documentMetadata"];
};

const FamilyContextContext = createContext<FamilyContextValue | null>(null);

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
  const [documentMetadata, setDocumentMetadata] = useState<FamilyContextValue["documentMetadata"]>(initialState?.documentMetadata ?? []);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [generation, setGeneration] = useState(0);
  const dirtyFormsRef = useRef<Map<string, () => boolean>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);

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

  const registerDirtyForm = useCallback((id: string, check: () => boolean) => {
    dirtyFormsRef.current.set(id, check);
    setDirtyCount(dirtyFormsRef.current.size);
    return () => {
      dirtyFormsRef.current.delete(id);
      setDirtyCount(dirtyFormsRef.current.size);
    };
  }, []);

  const isDirty = useMemo(() => {
    if (dirtyCount === 0) return false;
    for (const check of dirtyFormsRef.current.values()) {
      if (check()) return true;
    }
    return false;
  }, [dirtyCount]);

  const switchStudent = useCallback(
    async (studentId: string) => {
      if (context === null || studentId === context.activeStudentId) return;
      /* Dirty-form guard: block the switch if any registered form has
         unsaved changes. The consumer shows a save/discard prompt. */
      for (const check of dirtyFormsRef.current.values()) {
        if (check()) {
          setSwitchError("Unsaved changes — save or discard before switching children.");
          return;
        }
      }
      setSwitching(true);
      setSwitchError(null);
      /* Fail closed: clear the outgoing child's context, document metadata,
         and bump the generation so every child-scoped consumer remounts. */
      const previousContext = context;
      setContext(null);
      setDocumentMetadata([]);
      setGeneration((gen) => gen + 1);
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
        /* Restore the previous context and generation; the switch never
           half-applies. */
        setContext(previousContext);
        setGeneration((gen) => gen + 1);
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
      generation,
      registerDirtyForm,
      isDirty,
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
      generation,
      registerDirtyForm,
      isDirty,
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
