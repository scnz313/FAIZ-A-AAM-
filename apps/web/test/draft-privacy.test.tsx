/**
 * Applicant draft privacy tests. The tab-session draft must hold only
 * non-sensitive recoverable fields (name, session/grade, prior school,
 * leaving-certificate status, section progress). Identity (DOB, gender,
 * place of birth), medical, address, contact (phone, email), and document
 * upload details are never written to any browser storage — they live in
 * component state only — and submission clears the draft keys.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ApplicationForm from "@/components/applicant/ApplicationForm";
import JobForm from "@/components/applicant/JobForm";
import { vacancies } from "@/modules/content/demo";
import { sessionKey } from "@/modules/services/session";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/apply/student",
  useSearchParams: () => new URLSearchParams(),
}));

const STUDENT_DRAFT_KEY = sessionKey("application-draft");
const JOB_DRAFT_KEY = sessionKey(`job-draft:${vacancies[0]!.slug}`);

const STUDENT_SENSITIVE_VALUES = [
  "2014-04-10", // dob
  "Female", // gender
  "Bandipora", // place of birth + address fields
  "+919000000000", // phone
  "demo@example.com", // email
  "Main Road", // house & street
  "193502", // PIN code
];

const JOB_SENSITIVE_VALUES = ["+919000000000", "applicant@example.com", "cv.pdf"];

/** Every value currently held in localStorage must be free of the sample
 * sensitive values (the draft privacy invariant). */
function expectLocalStorageClean(sensitiveValues: string[]): void {
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    const value = window.localStorage.getItem(key) ?? "";
    for (const sensitive of sensitiveValues) {
      expect(value).not.toContain(sensitive);
    }
  }
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  pushMock.mockClear();
});

describe("student application draft privacy", () => {
  it("persists only non-sensitive fields to session storage", async () => {
    const user = userEvent.setup();
    render(<ApplicationForm />);

    /* Step 1 — academic. */
    await user.selectOptions(screen.getByLabelText(/^Academic session/), "2026-27");
    await user.selectOptions(screen.getByLabelText(/^Class /), "Class 6");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 2 — student details (identity: name + sensitive). */
    await user.type(screen.getByLabelText(/^Full name/), "Demo Student");
    await user.type(screen.getByLabelText(/^Date of birth/), "2014-04-10");
    await user.selectOptions(screen.getByLabelText(/^Gender/), "Female");
    await user.type(screen.getByLabelText(/^Place of birth/), "Bandipora");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 3 — guardian (name + sensitive contacts). */
    await user.type(screen.getByLabelText(/^Parent \/ guardian name/), "Demo Guardian");
    await user.selectOptions(screen.getByLabelText(/^Relationship to the student/), "Father");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "demo@example.com");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* Step 4 — address (all sensitive). */
    await user.type(screen.getByLabelText(/^House & street/), "Main Road");
    await user.type(screen.getByLabelText(/^Village \/ town/), "Bandipora");
    await user.type(screen.getByLabelText(/^District/), "Bandipora");
    await user.type(screen.getByLabelText(/^PIN code/), "193502");
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    /* The debounced autosave has flushed the non-sensitive tab draft. */
    await waitFor(() => {
      const raw = window.sessionStorage.getItem(STUDENT_DRAFT_KEY);
      expect(raw).not.toBeNull();
      const draft = JSON.parse(raw ?? "{}") as Record<string, unknown>;
      expect(draft.step).toBe(4);
      expect(draft.session).toBe("2026-27");
      expect(draft.grade).toBe("Class 6");
      expect(draft.studentName).toBe("Demo Student");
      expect(draft.guardianName).toBe("Demo Guardian");
      const serialized = JSON.stringify(draft);
      for (const sensitive of STUDENT_SENSITIVE_VALUES) {
        expect(serialized).not.toContain(sensitive);
      }
      expect(draft.dob).toBeUndefined();
      expect(draft.gender).toBeUndefined();
      expect(draft.phone).toBeUndefined();
      expect(draft.email).toBeUndefined();
      expect(draft.documents).toBeUndefined();
      expect(draft.conditions).toBeUndefined();
    });

    /* localStorage never receives the draft — old or new key. */
    expect(window.localStorage.getItem(STUDENT_DRAFT_KEY)).toBeNull();
    expect(window.localStorage.getItem("fass-application-draft")).toBeNull();
    expectLocalStorageClean(STUDENT_SENSITIVE_VALUES);
  });
});

describe("job application public form privacy", () => {
  it("keeps every answer on the page and never writes a browser draft", async () => {
    const user = userEvent.setup();
    render(<JobForm vacancy={vacancies[0]!} />);

    await user.type(screen.getByLabelText(/^Full name/), "Demo Applicant");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "applicant@example.com");
    await user.click(screen.getByRole("button", { name: /Save & continue/ }));

    await user.selectOptions(screen.getByLabelText(/^Highest qualification/), "Bachelor of Education (B.Ed.)");
    await user.type(screen.getByLabelText(/^Subject \/ specialisation/), "Mathematics");
    await user.selectOptions(screen.getByLabelText(/^Years of experience/), "3–5 years");
    await user.type(screen.getByLabelText(/^Current role/), "Teacher");
    await user.click(screen.getByRole("button", { name: /Save & continue/ }));

    /* The public form is deliberately storage-free before submission: the
       applicant has no account and no draft is persisted anywhere. */
    expect(window.sessionStorage.getItem(JOB_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expectLocalStorageClean(JOB_SENSITIVE_VALUES);
    expect(screen.getByText("Demo Applicant")).toBeInTheDocument();
  });

  it("shows the honest email-only success state without a draft key", async () => {
    const user = userEvent.setup();
    render(<JobForm vacancy={vacancies[0]!} />);

    await user.type(screen.getByLabelText(/^Full name/), "Demo Applicant");
    await user.type(screen.getByLabelText(/^Phone/), "+919000000000");
    await user.type(screen.getByLabelText(/^Email/), "applicant@example.com");
    await user.click(screen.getByRole("button", { name: /Save & continue/ }));

    await user.selectOptions(screen.getByLabelText(/^Highest qualification/), "Bachelor of Education (B.Ed.)");
    await user.selectOptions(screen.getByLabelText(/^Years of experience/), "3–5 years");
    await user.click(screen.getByRole("button", { name: /Save & continue/ }));

    await user.click(screen.getByLabelText(/I confirm that the information/));
    await user.click(screen.getByRole("button", { name: /Submit application/ }));

    await waitFor(() => {
      expect(screen.getByText("Thank you · your application is with the school.")).toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();

    expect(window.sessionStorage.getItem(JOB_DRAFT_KEY)).toBeNull();
    expect(window.localStorage.getItem(JOB_DRAFT_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(STUDENT_DRAFT_KEY)).toBeNull();
    expect(window.localStorage.getItem("fass-application-draft")).toBeNull();
  });
});
