# Test Staff Accounts (synthetic, staging only)

Created by `scripts/seed-test-accounts.mjs` against the linked Supabase project.
Fictional data only — never use in production or with real data.

## Sign-in

- **URL:** `/sign-in/staff`
- **Password (all accounts):** supplied through the `TEST_ACCOUNT_PASSWORD` environment value — never committed to the repository. The seed script refuses empty, short, or known-default passwords.
- First sign-in per account enrolls TOTP (plan.md §4). After enrollment, the
  authenticator secret stored for that account is required for later logins.

## Accounts

| Role | Email | Display name |
|------|-------|--------------|
| content_editor | `test.content_editor@faizaam.example` | Content Editor |
| content_publisher | `test.content_publisher@faizaam.example` | Cara Publisher |
| admissions_officer | `test.admissions_officer@faizaam.example` | Aam Officer |
| admissions_approver | `test.admissions_approver@faizaam.example` | Aam Approver |
| finance_officer | `test.finance_officer@faizaam.example` | Faisal Officer |
| finance_approver | `test.finance_approver@faizaam.example` | Faisal Approver |
| teacher | `test.teacher@faizaam.example` | Tariq Teacher |
| exam_reviewer | `test.exam_reviewer@faizaam.example` | Eshaal Reviewer |
| result_publisher | `test.result_publisher@faizaam.example` | Rashid Publisher |
| timetable_manager | `test.timetable_manager@faizaam.example` | Tahir Manager |
| hr_reviewer | `test.hr_reviewer@faizaam.example` | Hina Reviewer |
| hr_approver | `test.hr_approver@faizaam.example` | Haroon Approver |
| support_officer | `test.support_officer@faizaam.example` | Sana Officer |
| auditor | `test.auditor@faizaam.example` | Ayesha Auditor |
| system_administrator | `test.system_administrator@faizaam.example` | Sami Admin |

## Recreate / refresh

```sh
node scripts/seed-test-accounts.mjs
```

The script is idempotent — re-running skips accounts that already exist.
