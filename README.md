# Arcadia Dashboard

Private, capacity-aware student planning dashboard hosted with OpenAI Sites.

The root route serves the dashboard. It stores user-owned plans and analytics in D1, overlays read-only Google Calendar commitments, writes study blocks to an Arcadia-created Google calendar, and uses the OpenAI Responses API for reviewable planning proposals.

Runtime configuration is documented in `.env.example`; secrets are configured through Sites and never committed.
