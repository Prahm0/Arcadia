# Arcadia

Private, adaptive student planner hosted with OpenAI Sites.

Arcadia now centres on one persisted planning loop:

1. Life setup captures subjects, assignments, fixed school and extracurricular commitments, sleep, and study capacity.
2. A deterministic scheduler splits remaining work into conflict-free sessions before each deadline.
3. Today and Schedule read the same D1 event records.
4. Completing or missing a session records activity and updates remaining work; missed work is replanned automatically.
5. Arcadia Mentor receives the student’s structured context and applies validated task, commitment, and recovery actions. OpenAI enhances open-ended interpretation when configured, while core structured actions remain available without a provider key.

Google Calendar import remains optional. Imported events are fixed and read-only; generated study blocks can be written to an Arcadia-created Google calendar.

Runtime configuration is documented in `.env.example`. All provider credentials stay server-side and are configured through Sites.
