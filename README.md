# Arcadia

Private, adaptive student planner hosted with OpenAI Sites.

Arcadia now centres on one persisted planning loop:

1. Life setup captures subjects, assignments, fixed school and extracurricular commitments, sleep, and study capacity.
2. A deterministic scheduler splits remaining work into conflict-free sessions before each deadline.
3. Today and Schedule read the same D1 event records.
4. Completing or missing a session records activity and updates remaining work; missed work is replanned automatically.
5. Arcadia Mentor receives the student’s structured context and applies validated task, commitment, and recovery actions. OpenAI enhances open-ended interpretation when configured, while core structured actions remain available without a provider key.

Google Calendar import remains optional. Imported events are fixed and read-only; generated study blocks can be written to an Arcadia-created Google calendar.

## Accounts and persistence

Arcadia owns its email/password accounts and stores account-owned planner data in D1. Registration requires email verification; password recovery and verified email changes use Resend. Sessions last 30 days and are kept in secure, HTTP-only cookies. Completed Study Tracker sessions and the selected theme sync across signed-in devices.

For local development, the database is stored in `.local/arcadia.sqlite` and verification/reset responses include a local testing link when Resend is not configured. Production requires `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `APP_ORIGIN`; the sender address must belong to a domain verified in Resend. Never put these values in client-side code.

Existing ChatGPT-authenticated planner records are claimed when a newly verified account has the same email address. If more than one legacy profile has the same normalized email, Arcadia refuses the automatic claim instead of choosing one.

Runtime configuration is documented in `.env.example`. All provider credentials stay server-side and are configured through Sites.
