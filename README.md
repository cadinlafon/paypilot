# PayPilot

AI-powered business management for PayPal merchants: transactions, invoices, payment links, subscriptions, expenses, customers, analytics, automations and an AI assistant — in one dashboard, with a hard separation between **Demo** and **Real** data.

> PayPilot is a business management tool. It is not audited accounting software and does not give tax, legal or investment advice.

---

## What works today

| Area | Demo Mode | Real Mode |
|---|---|---|
| Mode selector, navigation, org switcher, global search (⌘K) | ✅ | ✅ |
| Auth (email/password, Google, reset, email verification) | Guest (no account) | ✅ Firebase Auth |
| Onboarding wizard, multiple organizations | 2 sample orgs | ✅ |
| Dashboard (12 widgets, drag to rearrange, hide, date/currency filters) | ✅ | ✅ |
| Transactions (filters, details, CSV, refund, capture) | ✅ refunds/captures **simulated** | ✅ PayPal **Sandbox** |
| Invoices (editor, preview, PDF, send, reminders, manual payments) | ✅ sending **simulated** | ✅ PayPal Invoicing or EmailJS |
| Payment links | ✅ sample links that **cannot accept money** | ✅ PayPal Checkout (Orders v2) |
| Subscriptions | ✅ sample | ✅ from PayPal webhooks (see notes) |
| Expenses (receipts, categories, FX, PayPal-purchase linking) | ✅ receipts stay in browser | ✅ Backblaze B2 |
| Customers & products | ✅ | ✅ |
| Analytics & reports (P&L view, multi-currency, CSV) | ✅ | ✅ |
| AI assistant (tools, charts, approval cards, history) | ✅ **simulated AI** (rule-based, free) | ✅ OpenRouter tool calling |
| Automations (Trigger → Condition → Action, test mode, history, retry) | ✅ | ✅ Firestore triggers + scheduler |
| Notifications & preferences | ✅ | ✅ |
| Roles & custom roles, team invites | ✅ simulated | ✅ enforced server-side |
| PayPal **Live** | — | ⛔ **Disabled** until PayPal partner approval (see below) |

Nothing is faked in Real Mode: if an integration isn't configured, the UI says so and the feature is unavailable rather than pretending to work.

---

## Architecture

```
paypilot/
├─ shared/                 Pure TypeScript shared by browser AND Cloud Functions
│  ├─ types.ts             Domain model (money = integer minor units, ISO dates)
│  ├─ permissions.ts       Permissions + system roles
│  ├─ money.ts             Formatting, FX conversion, invoice totals
│  ├─ dates.ts             Timezone-aware ranges/buckets
│  ├─ analytics.ts         Gross / refunds / fees / expenses / net, anomalies…
│  ├─ automations.ts       Trigger/action catalog + pure planner
│  ├─ aiTools.ts           AI tool definitions + implementations
│  └─ files.ts             Upload validation
├─ src/                    React + Vite + Tailwind v4 app
│  ├─ data/repository.ts   One interface, two implementations:
│  │  ├─ demo/             Browser-only demo store (never touches Firestore)
│  │  └─ real/             Firestore reads + Cloud Function calls
│  ├─ context/             Auth + Workspace (mode, org, permissions, data cache)
│  ├─ components/          UI kit, layout (ModeBar, Sidebar, Topbar), approvals
│  └─ pages/               One file per section (+ sub-components)
├─ functions/              Firebase Cloud Functions (Node 22)
│  └─ src/
│     ├─ lib/              Auth guard, rate limit, AES-GCM, audit, params
│     ├─ orgs.ts           Orgs, members, roles, invites
│     ├─ paypal/           Client, connect, sync, webhooks, records
│     ├─ actions.ts        Refund, capture, links, invoices, email, approvals
│     ├─ ai/chat.ts        OpenRouter tool-calling loop
│     ├─ automations/      Engine (triggers + hourly scheduler)
│     ├─ email/emailjs.ts  Email provider interface (EmailJS)
│     ├─ storage/b2.ts     Backblaze B2 private storage
│     └─ fx/               Exchange-rate provider interface (Frankfurter)
├─ firestore.rules         Strict, org-scoped, permission-checked
└─ tests/rules.test.mjs    27 security-rule tests (emulator)
```

### Demo vs Real isolation
* Switching modes swaps the whole `Repository`; every listener and cache is torn down.
* Demo data is generated deterministically in the browser and stored in `localStorage` (`paypilot:demo:v3:<orgId>`). It never reaches Firestore or any external API.
* Every demo record is `source: "demo"`; every simulated action says so in the UI and toasts.
* Real Mode never falls back to demo data — without a connection it shows onboarding/empty states.

### Approval system
The AI assistant and automations **cannot execute external actions**. Tools return `approval` effects that are saved to `organizations/{orgId}/aiActions` as `pending`. Only `decideApproval` (a human, with the matching permission) can execute them; it claims the request in a transaction so it runs at most once, and logs the decision. Human-initiated actions (Send invoice, Refund, Capture, Create link) always go through a confirmation dialog.

### Firestore layout
```
users/{uid}                         { orgs: [{id,name,roleId}] }      (server-written)
invites/{orgId_email}                                                  (server-only)
organizations/{orgId}               settings, reportingCurrency, timezone
  members/{uid}                     roleId, permissions[] (denormalized), status
  roles/{roleId}                    system + custom roles
  private/paypal_{env}              encrypted credentials + webhookId  (never readable)
  paypalConnections/{env}           public connection status
  transactions/ invoices/ customers/ products/ subscriptions/ expenses/
  paymentLinks/ notifications/ automations/ automationRuns/ tasks/
  aiConversations/ aiActions/ analytics/ exchangeRates/ files/
  activityLogs/ emailLogs/ syncHistory/ webhookEvents/
```
Business records carry `orgId`, ISO timestamps and `archivedAt` (soft delete). PayPal-derived docs use deterministic IDs (`pp_<paypal id>`), so sync and webhooks are idempotent.

### Multi-currency
Original `currency/gross/fee/net` are never modified. Converted amounts live in `reporting { currency, gross, fee, net, rate, rateTimestamp, provider, estimated }`. Rates are fetched per date from the configured provider (default **Frankfurter**, free ECB reference rates) and cached per org in `exchangeRates/`. Same-day or missing-date conversions are flagged **estimated**. Records with no available rate are excluded from converted totals and counted separately.

### Financial definitions
* **Gross receipts** — settled incoming payments (completed/refunded/partially refunded).
* **Refunds**, **Processing fees**, **Expenses** — always shown separately.
* **Net revenue** = gross − refunds − fees. **Net after expenses** = net revenue − expenses.
* PayPal *purchases* (outgoing) are never revenue. Recording one as an expense links it (`linkedTransactionId`) so it's counted once.

---

## Running locally

```bash
npm install
npm run dev            # http://localhost:5320
```

With no `.env`, PayPilot runs in **Demo-only** mode: use “Explore the demo without an account”.

### Full local stack (emulators)

```bash
cp .env.example .env               # set VITE_FIREBASE_* and VITE_USE_EMULATORS=true
cp functions/.env.example functions/.env
npm --prefix functions install
npm --prefix functions run build
firebase emulators:start --project demo-paypilot
npm run dev
```

### Tests

```bash
npm run typecheck                  # frontend + shared
npm --prefix functions run typecheck
npm run test:rules                 # Firestore rules against the emulator (needs Java)
```

---

## Hosting without Firebase billing (default)

Firebase's free **Spark** plan can't run Cloud Functions, so PayPilot runs its server code on a **Cloudflare Worker (free plan)** instead, and the Worker also serves the web app:

| Piece | Where | Cost |
|---|---|---|
| Sign-in | Firebase Authentication | Free (Spark) |
| Database + security rules | Cloud Firestore | Free (Spark quotas) |
| Web app + API + webhooks + scheduled jobs | Cloudflare Worker (`worker/`) | Free plan |

The Worker runs the **same code** as `functions/` by aliasing the `firebase-*` imports to small stand-ins in `worker/src/shims/`:
* `firebase-admin/firestore` → Firestore REST API with a service account
* callables → `POST /api/call/<name>` with the user's Firebase ID token (verified against Google's certificates)
* Cloud Scheduler → Cron Triggers (`*/15`, hourly, 03:30 UTC)
* Firestore triggers → a **change sweeper** (`worker/src/sweep.ts`) that runs every 15 minutes, after every API call, and when the app saves customers/expenses; it's idempotent via per-document shadows
* TTL policy (billing) → cron cleanup of expired rate-limit records

`functions/` still deploys unchanged to Firebase Functions if you ever enable Blaze (`VITE_BACKEND=firebase`).

**Free-plan limits to know:** ~50 outbound requests and ~10 ms CPU per call. Long jobs (sync, scheduler) stop early and resume on the next run via cursors; AI/analytics load at most `DATASET_TX_LIMIT` (1,000) recent transactions. Fine for a small business; large accounts would need the $5/mo Workers plan.

### Local development
```bash
firebase emulators:start --only auth,firestore     # terminal 1
cp worker/.dev.vars.example worker/.dev.vars       # set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 + a CREDENTIALS_ENCRYPTION_KEY
npm --prefix worker run dev                        # terminal 2 — API on :8787
echo VITE_USE_EMULATORS=true > .env.local && npm run dev   # terminal 3 — app on :5320 (proxies /api)
npm run test:e2e                                   # 39 end-to-end API checks
```

### Deploy
```bash
npx --prefix worker wrangler login
cd worker
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT      # paste the service-account JSON
npx wrangler secret put CREDENTIALS_ENCRYPTION_KEY    # openssl rand -base64 32
npx wrangler secret put OPENROUTER_API_KEY            # optional, enables AI
npx wrangler secret put EMAILJS_PRIVATE_KEY           # optional, enables email
npx wrangler secret put B2_KEY_ID                     # optional, enables receipts
npx wrangler secret put B2_APPLICATION_KEY
npm run deploy                                        # builds the app and deploys the Worker
```
Then set `APP_BASE_URL` in `wrangler.toml` to the URL wrangler prints and add that domain under Firebase Authentication → Settings → Authorized domains.

## Setup checklist (Firebase Functions alternative — requires Blaze)

1. **Firebase** — create a project; enable Authentication (Email/Password + Google) and Firestore. Upgrade to Blaze (required for Cloud Functions and outbound network calls).
2. **Frontend env** — copy `.env.example` → `.env`, fill `VITE_FIREBASE_*`.
3. **Functions env** — copy `functions/.env.example` → `functions/.env`; set `APP_BASE_URL` to your **https** Hosting URL.
4. **Secrets**
   ```bash
   firebase functions:secrets:set CREDENTIALS_ENCRYPTION_KEY   # openssl rand -base64 32
   firebase functions:secrets:set OPENROUTER_API_KEY
   firebase functions:secrets:set EMAILJS_PRIVATE_KEY
   firebase functions:secrets:set B2_KEY_ID
   firebase functions:secrets:set B2_APPLICATION_KEY
   ```
5. **Deploy**
   ```bash
   npm run build
   firebase deploy --only firestore,functions,hosting
   ```
6. **PayPal Sandbox** — at developer.paypal.com → Apps & Credentials → **Sandbox**, create a REST app; enable *Transaction Search*, *Invoicing* and *Subscriptions*. In PayPilot: Real Mode → Integrations → **Connect Sandbox**, paste client ID + secret. PayPilot verifies them, encrypts them (AES-256-GCM), registers a webhook at `APP_BASE_URL/api/paypal/webhook?org=…`, and starts syncing.
7. **EmailJS** — create a service and templates using `{{to_email}} {{to_name}} {{subject}} {{message}} {{from_name}} {{reply_to}}`. In *Account → Security*, enable **API access for non-browser applications** (server-side sending with the private key).
8. **Backblaze B2** — create a **private** bucket and an application key restricted to that bucket. Set `B2_BUCKET_ID`, `B2_BUCKET_NAME`.
9. **OpenRouter** — create an API key; adjust `OPENROUTER_ALLOWED_MODELS`/`OPENROUTER_DEFAULT_MODEL` if you want different models.

### Missing keys
Each integration degrades independently: the Integrations page shows what's missing, the related actions return a clear error, and nothing reports success it didn't achieve.

---

## Security

* **Server-side authorization** on every callable (`requireMember`): re-reads membership; never trusts client-supplied org IDs or permissions.
* **Strict Firestore rules**: org isolation, per-collection permissions, field validation, server-only collections, no client hard-deletes, credentials unreadable. Covered by `tests/rules.test.mjs`.
* **Secrets** only in Cloud Functions secrets; PayPal credentials encrypted per org per environment; Sandbox and Live stored separately.
* **Webhooks**: PayPal signature verification on every event, per-org webhook ID binding, dedupe by event ID, retries with backoff, failure alerts.
* **Files**: type allow-list, size limit, magic-byte sniffing, org-namespaced keys, 5-minute single-file download authorizations.
* **Rate limiting** on auth-sensitive and costly calls (AI, sync, uploads, refunds, invites).
* **Audit log** of settings changes, money movement, approvals, AI drafts and uploads.
* **CSV export** escapes formula injection; Hosting sets security headers.

## PayPal Live — why it's off
Ordinary REST credentials only authorize *your own* PayPal account. Connecting other businesses' Live accounts requires PayPal partner onboarding (Partner Referrals / multiparty permissions) and approval. Until that's in place:
* `PAYPAL_LIVE_ENABLED` defaults to `false`; every Live call is refused server-side.
* The UI shows Live as “requires approval”.
* The architecture is ready: credentials, connections, transactions and webhooks are already keyed by environment.

## Known limitations
* **Subscriptions**: PayPal has no “list all subscriptions” API; subscriptions appear as `BILLING.SUBSCRIPTION.*` webhooks arrive (then are fetched authoritatively).
* **Transaction Search** indexes new activity with up to ~3 hours' delay; webhooks fill the gap and nightly reconciliation re-checks 90 days.
* **Payment links** create a fresh PayPal order per checkout (hosted at `/api/pay/...`); PayPal's own “Payment Links” product isn't used.
* Real-Mode lists load the most recent 5,000 transactions client-side; very large accounts would need server-side pagination/aggregation.
* The demo assistant is rule-based (no LLM) by design; Real Mode uses OpenRouter.
* No billing for PayPilot itself (out of scope).
