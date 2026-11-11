# PayPilot — service setup checklist

Live app: **https://paypilot.web.app** (Firebase Hosting) — API: https://paypilot.cadinlafon.workers.dev (also serves the app)
Secrets are stored with `npx wrangler secret put NAME` (run inside `worker/`). Plain settings live in `worker/wrangler.toml` → `[vars]`; after editing it, run `npm --prefix worker run deploy`.

---

## 1. Firebase (sign-in + database) — free Spark plan
Status: ✅ project `paypilot-afc59`, web app, Firestore, rules and indexes deployed. ✅ Email/Password + Google enabled (by you).

- [ ] **Authorized domain** — Firebase console → Authentication → Settings → Authorized domains → **Add domain** → `paypilot.web.app` and `paypilot.cadinlafon.workers.dev`. Needed for Google sign-in and email links on the live site.
- [ ] **Rotate the service-account key** (it was pasted into a chat): Project settings → Service accounts → *Generate new private key*, then
  `cd worker && npx wrangler secret put FIREBASE_SERVICE_ACCOUNT` (paste the new JSON), then delete the old key (ID `e35d9d86…`) in Google Cloud console → IAM → Service accounts → Keys.
- [ ] Optional: Authentication → Templates → customize the verification / password-reset emails (sender name "PayPilot").

## 2. Cloudflare (runs the app + server) — free plan
Status: ✅ Worker `paypilot` deployed with cron jobs; `FIREBASE_SERVICE_ACCOUNT` and `CREDENTIALS_ENCRYPTION_KEY` set.

- Nothing required. Optional: Workers → paypilot → Settings → Domains → add a custom domain, then update `APP_BASE_URL` in `wrangler.toml`, add the domain to Firebase authorized domains, and redeploy.
- Don't delete or change `CREDENTIALS_ENCRYPTION_KEY` — it decrypts stored PayPal secrets (if it's ever lost, just reconnect PayPal).

## 3. PayPal — connect inside the app
Done entirely in PayPilot: during business setup choose **Connect PayPal → Sandbox or Live**, or later via **Integrations → Connect PayPal**.

**Sandbox (test money)**
1. https://developer.paypal.com → log in with your PayPal account → *Apps & Credentials* → **Sandbox** tab → *Create App* (type: Merchant).
2. In the app's features, enable **Transaction Search**, **Invoicing**, **Subscriptions** (and keep *Accept payments*).
3. Copy the **Client ID** and **Secret** into PayPilot.
4. Test buyers: *Testing Tools → Sandbox Accounts* gives you a fake personal account to pay links/invoices with.

**Live (real money)**
1. Requires a **PayPal Business** account.
2. Same page → **Live** tab → *Create App*, enable the same features.
3. Copy the Live **Client ID** and **Secret** into PayPilot (choose *Live*).
4. Transaction Search can take a few hours to activate on new Live apps; syncing retries automatically.

PayPilot verifies the credentials with PayPal, registers its webhook automatically (`https://paypilot.cadinlafon.workers.dev/api/paypal/webhook`), and starts syncing. To allow Sandbox only, set `PAYPAL_LIVE_ENABLED = "false"` in `wrangler.toml`.

## 4. OpenRouter (AI assistant in Real Mode) — ✅ configured, FREE models only
Key stored as the `OPENROUTER_API_KEY` secret. Only `:free` models are allowed (`ONLY_FREE_MODELS = "true"`), and the server rejects anything else:
Nemotron 3.5 Super (default), Nemotron 3.5 Lightning, Gemma 4 31B, Gemma 4 26B. If one is busy, OpenRouter falls back to the next.
Free-model limits are set by OpenRouter (roughly 20 requests/minute and a daily cap that's higher once an account has bought credits); one assistant message can use several requests.
Without it, Real Mode shows "AI isn't configured" (Demo Mode's simulated assistant still works).

## 5. EmailJS (invoice emails, reminders, customer + automation emails) — ✅ configured, free tier
Same approach as centre-floor-app: **emails are sent from the signed-in user's browser** with the EmailJS public key. No Cloud Functions, no private key, no EmailJS security changes.
The server still decides *whether* an email may go out (permissions, approvals), writes it, and logs it; the browser just delivers it and reports back (log shows *queued* → *sent*/*failed*).

Configured in `worker/wrangler.toml`: service `service_hhsy35q`, public key `CnFo1Rsdnl3BY9_uS`, template `template_r67co3i` (used for every email type).

- [ ] Make sure template `template_r67co3i` uses these fields (EmailJS → Email Templates):
   | Template field | Value |
   |---|---|
   | Subject | `{{subject}}` |
   | Content | `{{message}}` (in HTML mode: `<div style="white-space:pre-line">{{message}}</div>`) |
   | To Email | `{{to_email}}` |
   | From Name | `{{from_name}}` |
   | Reply To | `{{reply_to}}` |
- [ ] EmailJS → Account → Security → if *Domains allowlist* is used, add `paypilot.web.app` and `paypilot.cadinlafon.workers.dev`.
- [ ] In PayPilot **Settings → Organization**, set the **Business email** — customers' replies go there.
- Optional: to send from the server instead (no browser needed), turn on *Allow EmailJS API for non-browser applications* and run `npx wrangler secret put EMAILJS_PRIVATE_KEY` in `worker/`. PayPilot switches automatically.

Emails PayPilot sends (only after you click Send/Remind or approve a request): invoices (when PayPal Invoicing isn't connected — otherwise PayPal emails the invoice itself), payment reminders, customer emails drafted by the AI, and "Send email" automation steps once approved.

## 6. Backblaze B2 (receipts & documents) — free up to 10 GB, optional
1. https://www.backblaze.com → B2 Cloud Storage → sign up.
2. **Buckets → Create a Bucket**: unique name, **Files: Private**. Note the **Bucket ID** and name.
3. **Application Keys → Add a New Application Key**: allow access to **that bucket only**, Read and Write. Copy **keyID** and **applicationKey** (shown once).
4. In `wrangler.toml` set `B2_BUCKET_ID`, `B2_BUCKET_NAME`; then
   `npx wrangler secret put B2_KEY_ID` and `npx wrangler secret put B2_APPLICATION_KEY`, and redeploy.

## 7. Exchange rates — nothing to set up
Uses Frankfurter (free ECB reference rates, no key).

---

### Quick reference — what each missing piece disables
| Missing | What stops working |
|---|---|
| PayPal | Syncing, payment links, refunds/captures, PayPal invoicing (manual records still work) |
| OpenRouter | Real-Mode AI assistant and AI briefings |
| EmailJS template fields | Emails arrive blank or to the wrong address |
| Backblaze B2 | Receipt and document uploads |
| Authorized domain | Google sign-in on the live site |
