/**
 * Public job-application form tests (owner requirement, 15 September 2026).
 *
 * The public applicant never signs in, never uploads a document, and may
 * attach one optional profile photo after submission. These tests lock the
 * public surface: no auth prompt, no document fields, honeypot present,
 * same-origin intake route usage, typed server errors surfaced honestly, and
 * the optional photo chain.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobForm from "@/components/applicant/JobForm";
import { vacancies } from "@/modules/content/demo";
import { CAREERS_SESSION_KEYS } from "@/modules/services/careers";

const { uploadToSignedUrlMock } = vi.hoisted(() => ({ uploadToSignedUrlMock: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: uploadToSignedUrlMock }) },
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    prefetch: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const vacancy = vacancies[0]!;
const serverVacancy = { ...vacancy, reference: "VAC-2026-40E963", version: 1 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Full name/), "Aisha Mir");
  await user.type(screen.getByLabelText(/^Email/), "aisha@example.com");
}

async function fillExperience(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/^Highest qualification/), "Bachelor of Education (B.Ed.)");
  await user.selectOptions(screen.getByLabelText(/^Years of experience/), "3–5 years");
}

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await fillContact(user);
  await user.click(screen.getByRole("button", { name: "Save & continue →" }));
  await screen.findByRole("heading", { name: "Experience & qualification" });
  await fillExperience(user);
  await user.click(screen.getByRole("button", { name: "Save & continue →" }));
  await screen.findByRole("heading", { name: "Review & consent" });
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  uploadToSignedUrlMock.mockReset();
  Object.values(CAREERS_SESSION_KEYS).forEach((key) => window.sessionStorage.removeItem(key));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("JobForm public surface", () => {
  it("renders without any sign-in prompt and without document requirements", async () => {
    render(<JobForm vacancy={vacancy} />);

    expect(screen.getByRole("heading", { name: "Your details" })).toBeInTheDocument();
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/log in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Documents required/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(0);
  });

  it("carries a honeypot field that people cannot reach", () => {
    render(<JobForm vacancy={vacancy} />);

    const honeypot = document.querySelector<HTMLInputElement>("#website");
    expect(honeypot).not.toBeNull();
    expect(honeypot?.tabIndex).toBe(-1);
    expect(honeypot?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("offers exactly one optional photo input on the review step and no document inputs", async () => {
    const user = userEvent.setup();
    render(<JobForm vacancy={vacancy} />);
    await reachReview(user);

    const fileInputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(fileInputs).toHaveLength(1);
    expect(fileInputs[0]?.accept).toBe("image/jpeg,image/png,image/webp");
    expect(screen.getByText(/None required · the school requests certificates only from shortlisted candidates/)).toBeInTheDocument();
  });

  it("rejects a non-image photo locally before any upload is attempted", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<JobForm vacancy={vacancy} />);
    await reachReview(user);

    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(fileInput, new File(["not an image"], "notes.txt", { type: "text/plain" }));

    expect(await screen.findByText("Choose a JPEG, PNG, or WebP image.")).toBeInTheDocument();
  });

  it("validates required fields before advancing", async () => {
    const user = userEvent.setup();
    render(<JobForm vacancy={vacancy} />);

    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    expect(await screen.findByText("Please correct the following before continuing.")).toBeInTheDocument();
    expect(screen.getByText("Enter your full name.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your details" })).toBeInTheDocument();
    /* Every error link keeps its actionable review wording in the accessible
       name, and focus moves to the first invalid answer. */
    expect(screen.getByRole("link", { name: /Enter your full name\. Review this answer/ })).toBeInTheDocument();
    expect(document.getElementById("fullName")).toHaveFocus();
  });
});

describe("JobForm public submission (demo adapter)", () => {
  it("submits through the local demo service and shows the email-only success state", async () => {
    const user = userEvent.setup();
    render(<JobForm vacancy={vacancy} />);
    await reachReview(user);

    await user.click(screen.getByLabelText(/I confirm that the information/));
    await user.click(screen.getByRole("button", { name: "Submit application →" }));

    expect(await screen.findByText("Thank you · your application is with the school.")).toBeInTheDocument();
    expect(screen.getByText(/HR office emails you whenever the status changes/)).toBeInTheDocument();
    const stored = window.sessionStorage.getItem(CAREERS_SESSION_KEYS.records);
    expect(stored ?? "").toContain("JOB-");
  });
});

describe("JobForm public submission (supabase adapter)", () => {
  it("posts to the same-origin public intake route with the vacancy version and honeypot", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ ok: true, reference: "JOB-2026-PUBLIC" }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<JobForm vacancy={serverVacancy} />);
    await reachReview(user);
    await user.click(screen.getByLabelText(/I confirm that the information/));
    await user.click(screen.getByRole("button", { name: "Submit application →" }));

    expect(await screen.findByText(/Every update arrives by email at/)).toBeInTheDocument();
    expect(screen.getByText("JOB-2026-PUBLIC")).toBeInTheDocument();

    const call = fetchMock.mock.calls[0]!;
    expect(String(call[0])).toBe("/api/careers/apply");
    const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      vacancyRef: "VAC-2026-40E963",
      vacancyVersion: 1,
      fullName: "Aisha Mir",
      email: "aisha@example.com",
      qualification: "Bachelor of Education (B.Ed.)",
      experience: "3–5 years",
      consent: true,
      website: "",
    });
    expect(body).not.toHaveProperty("documents");
    expect(body).not.toHaveProperty("ownerAccountId");
  });

  it("surfaces a typed duplicate rejection and keeps the applicant's answers on the page", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ok: false,
      code: "duplicate",
      error: "An application for this vacancy was already received from this email address.",
    }, 409)));

    const user = userEvent.setup();
    render(<JobForm vacancy={serverVacancy} />);
    await reachReview(user);
    await user.click(screen.getByLabelText(/I confirm that the information/));
    await user.click(screen.getByRole("button", { name: "Submit application →" }));

    expect(await screen.findByText("An application for this vacancy was already received from this email address.")).toBeInTheDocument();
    expect(screen.getByText("Aisha Mir")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit application →" })).toBeEnabled();
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
  });

  it("attaches the one optional photo after submission and reports its scan state", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    uploadToSignedUrlMock.mockResolvedValue({ error: null });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/careers/apply") return jsonResponse({ ok: true, reference: "JOB-2026-PHOTO" });
      if (url === "/api/careers/apply/photo-intent") {
        return jsonResponse({ ok: true, documentRef: "DOC-2026-0001", objectKey: "uploads/opaque.jpg", token: "token-1", bucket: "fass-private-documents" });
      }
      if (url === "/api/careers/apply/photo-finalize") return jsonResponse({ ok: true, documentRef: "DOC-2026-0001", state: "pending_scan" });
      throw new Error(`unexpected fetch ${url} ${String(init?.method ?? "")}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<JobForm vacancy={serverVacancy} />);
    await reachReview(user);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(fileInput, new File(["jpeg-bytes"], "profile.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("Selected: profile.jpg")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/I confirm that the information/));
    await user.click(screen.getByRole("button", { name: "Submit application →" }));

    expect(await screen.findByText("Thank you · your application is with the school.")).toBeInTheDocument();
    expect(await screen.findByText(/awaiting the school.s safety scan/)).toBeInTheDocument();
    expect(uploadToSignedUrlMock).toHaveBeenCalledWith("uploads/opaque.jpg", "token-1", expect.any(File), { contentType: "image/jpeg" });
    const finalize = fetchMock.mock.calls.find((call) => String(call[0]) === "/api/careers/apply/photo-finalize");
    expect(finalize).toBeDefined();
    expect(JSON.parse(String((finalize?.[1] as RequestInit).body))).toEqual({ reference: "JOB-2026-PHOTO", documentRef: "DOC-2026-0001" });
  });

  it("keeps the application successful when the optional photo cannot be attached", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    uploadToSignedUrlMock.mockResolvedValue({ error: { message: "storage down" } });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/careers/apply") return jsonResponse({ ok: true, reference: "JOB-2026-NOPHOTO" });
      if (url === "/api/careers/apply/photo-intent") {
        return jsonResponse({ ok: true, documentRef: "DOC-2026-0002", objectKey: "uploads/opaque.png", token: "token-2", bucket: "fass-private-documents" });
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const user = userEvent.setup();
    render(<JobForm vacancy={serverVacancy} />);
    await reachReview(user);
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(fileInput, new File(["png-bytes"], "profile.png", { type: "image/png" }));
    await user.click(screen.getByLabelText(/I confirm that the information/));
    await user.click(screen.getByRole("button", { name: "Submit application →" }));

    expect(await screen.findByText("Thank you · your application is with the school.")).toBeInTheDocument();
    expect(screen.getByText(/the profile photo could not be attached/)).toBeInTheDocument();
  });

  it("never calls the account-bound draft or submit services in supabase mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_FASS_DATA_ADAPTER", "supabase");
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, reference: "JOB-2026-NODRAFT" }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<JobForm vacancy={serverVacancy} />);
    await fillContact(user);
    await user.click(screen.getByRole("button", { name: "Save & continue →" }));

    await screen.findByRole("heading", { name: "Experience & qualification" });
    /* The old account-bound flow autosaved through the adapter as soon as a
       name existed, which failed without a session. The public form keeps
       answers on the page and never calls an authenticated boundary. */
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
