# Research notes and implementation sources

External sources checked 3 August 2026. The code and integration contracts were re-audited on 5 August 2026; external sources were not re-fetched during that code-first audit.

This file supports policy/provider decisions. It does not define the current implementation state or the relationship model; use `../PROJECT-STATUS.md` and `../FEATURE-INTEGRATION-SPEC.md` for those.

## School and regional context

- [FAIZ E AAM SECONDARY SCHOOL BANDIPORA — public Facebook page](https://www.facebook.com/100063937664421/)
- [Kashmir Harvard Educational Institute](https://kashmirharvard.com/) — regional reference for notices, learning stages, achievements, app/fee management, and school disclosures.
- [Foundation World School](https://foundationworldschool.com/) — regional reference for academic pathways, careers, student corner, and legal compliance.

The school’s address, affiliation, grades, leadership, contacts, dates, and official assets were not reliably available from a first-party school website and remain verification items.

## Public disclosure

- [CBSE Affiliation Bye-Laws](https://www.cbse.gov.in/cbsenew/aff-bye-laws.html) describe website/annual-report expectations for CBSE-affiliated schools.
- [CBSE mandatory public disclosure reminder](https://saras.cbse.gov.in/saras/Circulars/Circular02_2022.pdf) requires a prominent “Mandatory Public Disclosure” entry on the homepage for CBSE-affiliated schools.

These are conditional requirements until the school’s affiliation is confirmed.

## Payments

- [RBI annual report](https://systemhealth.rbi.org.in/Scripts/AnnualReportPublications.aspx_Id%3D1409%281%29.html) records the increase of the UPI limit for payments to educational institutions to ₹5 lakh per transaction.
- [RBI e-mandate update of 22 August 2024](https://www.rbi.org.in/scripts/bs_circularindexdisplay.aspx/Scripts/BS_CircularIndexDisplay.aspx?Id=12722) reiterates pre-debit notification under the recurring-payment framework.
- [NPCI UPI AutoPay](https://www.npci.org.in/product/autopay) documents mandate registration, pre-debit notification, and modify/revoke/pause controls.
- [Razorpay UPI documentation](https://razorpay.com/docs/payments/payment-methods/upi/) says UPI Collect is deprecated from 28 February 2026 for most flows; use Intent or QR.
- [Razorpay webhook guidance](https://razorpay.com/docs/webhooks/) distinguishes asynchronous server webhooks from browser callbacks and recommends API verification for time-sensitive confirmation.
- [Cashfree payment webhooks](https://www.cashfree.com/docs/api-reference/payments/latest/payments/webhooks) documents signature headers and success/failed/user-dropped events.

No gateway has been selected. The product design is provider-neutral and assumes the final provider supports INR, UPI Intent/QR, signed webhooks, refunds, settlements, sandbox testing, and merchant onboarding appropriate to the school.

## Privacy, security, and accessibility

- [Digital Personal Data Protection Act, 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf) is the privacy baseline; implementation should be reviewed against the rules and school counsel before production.
- [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) is the accessibility target; use Level AA for both public and signed-in experiences.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## Tool/plugin record

- **In-app Browser:** inspected the school’s public identity and regional school websites.
- **Monid:** installed at the required version, but discovery could not run because no active key is configured. Setup requires a key created at <https://app.monid.ai/access/api-keys>; do not paste it into chat.
- **Web research:** checked current first-party CBSE, RBI/NPCI, W3C, MEITY, OWASP, Razorpay, and Cashfree sources.
- **UI rendering:** produced inspectable HTML/CSS interface mockups and browser-rendered design images. The current direction does not depend on school photography.
- Other connected tools were not invoked when they added no evidence or design value; connectors should not receive school/student data merely because they are installed.

## Three-portal consolidation research (31 August 2026)

Sources checked for the three-portal consolidation (guardian mobile-OTP onboarding, result entry split, and import/export work):

- [Supabase phone login (OTP)](https://supabase.com/docs/guides/auth/phone-login) — primary guardian invitation/sign-in channel.
- [Supabase email OTP / passwordless](https://supabase.com/docs/guides/auth/auth-email-passwordless) — email fallback when mobile delivery is unavailable.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html) — OTP issue/verify, rate limiting, and session controls for the invite-and-claim flow.
- [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) — required hardening for guardian/student import previews and staff exports.
- [TRAI advice to senders](https://www.trai.gov.in/advice-to-senders) — sender ID/DLT registration prerequisites for transactional SMS in India.

Notes:

- DPDP child/guardian consent material must be rechecked with school counsel before guardian onboarding ships; the DPDP sources in this file predate the consolidation and were not re-fetched for it.
- SMS remains blocked until TRAI/DLT sender registration and provider approval are complete; guardian invitations use the email OTP fallback until then.
