export const DEVELOPMENT_ACCOUNTS = [
  {
    id: "parent",
    label: "Guardian",
    email: "p@faizaam.example",
    audience: "family",
    destination: "/portal",
  },
  {
    id: "student-applicant",
    label: "Student applicant",
    email: "a@faizaam.example",
    audience: "family",
    destination: "/apply/student",
  },
  {
    id: "job-applicant",
    label: "Job applicant",
    email: "j@faizaam.example",
    audience: "family",
    destination: "/careers",
  },
  {
    id: "administrator",
    label: "Administrator",
    email: "ad@faizaam.example",
    audience: "staff",
    destination: "/administrator",
  },
  {
    id: "principal",
    label: "Principal",
    email: "pr@faizaam.example",
    audience: "staff",
    destination: "/principal",
  },
] as const;

export type DevelopmentAccount = (typeof DEVELOPMENT_ACCOUNTS)[number];
export type DevelopmentAccountId = DevelopmentAccount["id"];
export type DevelopmentAccountAudience = DevelopmentAccount["audience"];

export function developmentAccount(id: string): DevelopmentAccount | null {
  return DEVELOPMENT_ACCOUNTS.find((account) => account.id === id) ?? null;
}
