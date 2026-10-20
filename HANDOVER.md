# Handover (for a new Claude account or developer)
**Start here, do not rebuild.** Everything is in this folder (a Git repo). Read, in order: `PROJECT_STATUS.md`, `ARCHITECTURE.md`, `INTEGRATIONS.md`, then `README.md`.
1. Requirements: Node >= 22.13. No `npm install` needed.
2. Setup: `cp .env.example .env`; `npm run migrate`; `npm run seed`; set `ADMIN_EMAIL`/`ADMIN_PASSWORD` and run `npm run create-admin`; `npm start`; open http://localhost:3000.
3. Verify the baseline: `npm test` must show 20 pass.
4. Business facts (source of truth): Nexoraith Absolute Ventures Ltd, RC 9921594, NEXORAITHABSOLUTEVENTURES@GMAIL.COM. No address or phone supplied: do not invent. Brand: navy + champagne gold primary, teal for buttons/interactive. Supplier intended: CJdropshipping. Payment candidate: Paystack. Owner is a beginner: give exact steps.
5. Never: expose supplier costs, trust browser prices, mark paid from a redirect, auto-submit supplier orders, claim integrations work without testing, add unapproved policies as final.
6. Next work, in priority order: (a) owner supplies Paystack TEST key -> run a real sandbox payment end to end and fix anything the docs disagree with; (b) owner supplies CJ key -> verify parameter names in `src/suppliers/cj.js`, add tracking sync; (c) real catalogue import; (d) confirm delivery zones/policies and replace draft policy text in `src/views.js` (`PAGES`); (e) email service for order confirmations; (f) original logo files + self-hosted fonts; (g) deploy per README section 6.
7. Reproduce an issue: write a test in `tests/shop.test.js` using `setup()` and `client()` helpers (real HTTP against a temp DB).
8. Memory/handoff note: chat history is not needed; all state is in these files and Git.
