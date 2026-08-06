/**
 * Deterministic tests for the per-student published result snapshot
 * (I2 item 3): the academics service owns the snapshot the portal renders,
 * Aarif's rows match the marks fixture exactly, Mariam has a distinct
 * fictional snapshot over the same subjects/maxima, students or years
 * without a snapshot return null, and the portal table renders the
 * snapshot rows — never a term fixture fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { MarksEntry } from "@/components/staff/MarksEntry";
import { STAFF_SESSION_KEYS, StaffContextProvider } from "@/components/staff/StaffContextProvider";
import { ResultTable } from "@/components/portal/ResultTable";
import { marksByTerm } from "@/modules/academics/demo";
import { setDemoNow } from "@/modules/demo/clock";
import { academicsService } from "@/modules/services/academics";
import { auditService, AUDIT_SESSION_KEY_EXPORT } from "@/modules/services/audit";
import { clearOutboxSession } from "@/modules/services/outbox";
import { sessionKey, sessionRemove, sessionSet } from "@/modules/services/session";
import { RELATIONSHIPS_SESSION_KEY } from "@/modules/services/family-context";
import type { EntryBatch } from "@/modules/services/academics";

const SESSION_KEY = sessionKey("academics");
const PINNED = "2026-08-10T05:00:00.000Z";
/** Firdous Ahmad — the demo teacher (Class 8-A · Mathematics, active). */
const TEACHER_ACCOUNT_ID = "00000000-0000-4000-8000-000000000201";

/* Stable IDs from the relationships fixture. */
const AARIF_ID = "00000000-0000-4000-8000-000000000901";
const MARIAM_ID = "00000000-0000-4000-8000-000000000902";
/** Zoya Khan (STU-2026-0903, Class 9-C) — no results snapshot in the demo. */
const ZOYA_ID = "00000000-0000-4000-8000-000000000903";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000009999";
const CURRENT_YEAR_ID = "00000000-0000-4000-8000-000000000602";
const COMPLETED_YEAR_ID = "00000000-0000-4000-8000-000000000601";

beforeEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(sessionKey("identity"));
  sessionRemove(STAFF_SESSION_KEYS.identity);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  setDemoNow(new Date(PINNED));
});

afterEach(() => {
  sessionRemove(SESSION_KEY);
  sessionRemove(sessionKey("identity"));
  sessionRemove(STAFF_SESSION_KEYS.identity);
  sessionRemove(RELATIONSHIPS_SESSION_KEY);
  clearOutboxSession();
  sessionRemove(AUDIT_SESSION_KEY_EXPORT);
  setDemoNow(null);
});

describe("getStudentResultSnapshot", () => {
  it("seeds Aarif's snapshot with values identical to the marks fixture", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(AARIF_ID, CURRENT_YEAR_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.studentId).toBe(AARIF_ID);
    expect(snapshot?.academicYearId).toBe(CURRENT_YEAR_ID);

    for (const label of ["Term 1", "Term 2"]) {
      const fixture = marksByTerm[label] ?? [];
      const rows = snapshot?.terms[label] ?? [];
      expect(rows).toHaveLength(fixture.length);
      rows.forEach((row, index) => {
        expect(row.subject).toBe(fixture[index]?.subject);
        expect(row.max).toBe(fixture[index]?.max);
        expect(row.obtained).toBe(fixture[index]?.obtained);
        expect(row.grade).toBe(fixture[index]?.grade);
        expect(row.remark).toBe(fixture[index]?.remark);
      });
    }
  });

  it("returns a distinct fictional snapshot for Mariam over the same subjects and maxima", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.studentId).toBe(MARIAM_ID);

    const fixture = marksByTerm["Term 1"] ?? [];
    const rows = snapshot?.terms["Term 1"] ?? [];
    expect(rows).toHaveLength(fixture.length);
    rows.forEach((row, index) => {
      expect(row.subject).toBe(fixture[index]?.subject);
      expect(row.max).toBe(fixture[index]?.max);
    });
    /* Distinct obtained values — the snapshot is per-student, not the fixture. */
    expect(rows[0]?.obtained).not.toBe(fixture[0]?.obtained);
    expect(rows.some((row, index) => row.obtained !== fixture[index]?.obtained)).toBe(true);
  });

  it("returns null for a student without a published snapshot", async () => {
    expect(await academicsService.getStudentResultSnapshot(ZOYA_ID, CURRENT_YEAR_ID)).toBeNull();
    expect(await academicsService.getStudentResultSnapshot(UNKNOWN_ID, CURRENT_YEAR_ID)).toBeNull();
  });

  it("returns null when the academic year has no snapshot", async () => {
    expect(await academicsService.getStudentResultSnapshot(AARIF_ID, COMPLETED_YEAR_ID)).toBeNull();
  });
});

describe("portal marks source", () => {
  it("never falls back to the term fixture while a snapshot exists for the active child", async () => {
    /* Mariam's snapshot rows differ from the fixture, so the only way the
     * portal can show her marks is the snapshot — a fixture fallback would
     * silently show Aarif's numbers. */
    const mariam = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    const mariamTerm1 = mariam?.terms["Term 1"] ?? [];
    const fixtureTerm1 = marksByTerm["Term 1"] ?? [];
    expect(mariamTerm1).not.toEqual(fixtureTerm1);
    expect(mariamTerm1[0]?.obtained).not.toBe(fixtureTerm1[0]?.obtained);
  });

  it("renders the active child's snapshot rows in ResultTable, not the fixture values", async () => {
    const snapshot = await academicsService.getStudentResultSnapshot(MARIAM_ID, CURRENT_YEAR_ID);
    const rows = snapshot?.terms["Term 1"] ?? [];
    expect(rows.length).toBeGreaterThan(0);

    render(
      <ResultTable
        term={{ id: "term-1", label: "Term 1", publicationStatus: "final", publishedAtIso: "2026-06-15T06:00:00Z" }}
        marks={rows}
      />,
    );

    /* Mariam's Term 1 total is 556/700 — distinct from the fixture total (593/700). */
    expect(screen.getByText("556")).toBeTruthy();
    expect(screen.getByText("700")).toBeTruthy();
    expect(screen.queryByText("593")).toBeNull();
    /* Mariam's English mark (78) is present; the fixture English mark (84) is not. */
    expect(screen.getByText("78")).toBeTruthy();
    expect(screen.queryByText("91")).toBeNull();
  });
});

describe("MarksEntry teacher scope (class + subject)", () => {
  it("denies a teacher entry when the batch class matches but the subject does not", async () => {
    sessionSet(STAFF_SESSION_KEYS.identity, TEACHER_ACCOUNT_ID);
    /* Synthetic batch: the real fixture RB-2026-0138 is 8-A · Mathematics,
       which IS assigned — the subject swap must flip the scope decision. */
    const outOfSubjectScope: EntryBatch = {
      ref: "RB-2026-0138",
      exam: "Term 1",
      className: "8-A",
      subject: "General Science",
      status: "draft",
      rows: [],
      totalsIncomplete: true,
      version: 1,
    };
    render(
      <StaffContextProvider>
        <MarksEntry batchRef="RB-2026-0138" initialBatch={outOfSubjectScope} />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("Outside your assignments")).toBeTruthy(), { timeout: 5_000 });
    expect(screen.getByText(/not in your assigned classes or subjects/)).toBeTruthy();
  });

  it("opens the workspace for a teacher when class and subject are both assigned", async () => {
    sessionSet(STAFF_SESSION_KEYS.identity, TEACHER_ACCOUNT_ID);
    const batch = await academicsService.getBatch("RB-2026-0138");
    expect(batch).not.toBeNull();
    render(
      <StaffContextProvider>
        <MarksEntry batchRef="RB-2026-0138" initialBatch={batch!} />
      </StaffContextProvider>,
    );

    await waitFor(() => expect(screen.getByText("Marks entry")).toBeTruthy(), { timeout: 5_000 });
    expect(screen.queryByText("Outside your assignments")).toBeNull();
  });
});
