# Glossy Looks → SMAV Central Identity Sync
## API Contract & Implementation Report (For SMAV Integration Review)

> **Audit Basis**: Verified directly against the current Glossy Looks codebase (`src/server/smav/smav_outlet_user_adapter.ts`, `src/server/smav/glossylooks_smav_auth_adapter.ts`, `src/server/smavSync.ts`, `server.ts`, `src/server/repositories/supabaseSalonRepository.ts`, `database/migrations/024_smav_user_sync_outbox.sql`, `vercel.json`, `.env.example`, `src/lib/api.ts`, `src/components/admin/AdminPortal.tsx`).  
> **Safety Note**: No production database rows were modified, no real passwords were reset, no live sync requests were sent, and no deployment was triggered.

---

## Executive Status Breakdown

### 1. Implemented and Verified (Offline / Static / Build)
- **Authoritative Source Anchored on `public.users`**: All admin user CRUD (`GET/POST /api/admin/users`, `PATCH/DELETE /api/admin/users/:id`, `POST /api/admin/users/:id/reset-password`) uses `public.users` as the RBAC source of truth, never `public.staff.role` job titles.
- **Exact RBAC Role Mapping**: `owner` / `manager` → `ADMIN`; `stylist` / `receptionist` / `inventory_staff` → `POS_BILLING`.
- **Outbound Target Path**: When `SMAV_GATEWAY_URL` is configured, `SmavOutletUserAdapter` sends `POST ${SMAV_GATEWAY_URL}/api/integrations/glossylooks/users/sync`.
- **Secret Hygiene**: `sanitizeOutboxPayload` and `sanitizeSyncError` strip passwords/tokens/keys before persistence; DB `CHECK` constraint `chk_smav_outbox_no_plaintext_secrets` blocks secret keys in `public.smav_user_sync_outbox.payload`; passwords (`initialPassword`, `newPassword`) are forwarded transiently in memory only.
- **Password Length Alignment**: UI modals and Express routes enforce `>= 8` characters on create (when password provided) and password reset.
- **Fail-Closed Identity Conflict Guards**:
  - Rejects local email changes if `central_auth_id` is not yet linked (attempts pre-link first; returns HTTP `409` if still unlinked).
  - Never overwrites an existing `central_auth_id` if SMAV returns a different UUID (`conflict: true`, status `FAILED`).
  - Treats HTTP `409` or `data.conflict === true` as permanent non-retryable `FAILED`.
- **Durable Outbox & Retry Logic**: Implemented in `src/server/smavSync.ts`, `src/server/repositories/supabaseSalonRepository.ts`, `src/server/db.ts`, and `database/migrations/024_smav_user_sync_outbox.sql`.
- **Admin UI Visibility & Safe Reconciliation**: Added `SMAV Sync` column (`SYNCED` / `PENDING` / `FAILED`, mapped role, UUID/safe error), Owner-only **Retry Sync** button, **Audit & Reconcile SMAV** modal (`dryRun: true` default; skips `NEEDS_MANUAL_REVIEW`), and accurate status-aware toasts.
- **Offline Verification Passed**:
  - `npx tsx scripts/test-smav-user-sync.ts`: **10/10 mocked tests passed** (role mapping, secret stripping, create, edit, role update, email change, deactivate, reactivate, password reset, idempotency replay, 503 exponential backoff retry → `SYNCED`, UUID/409 fail-closed conflict, and dry-run/apply reconciliation skipping Renuka-style UUID mismatch).
  - `npm run build`: **Succeeded**.
  - `tsc --noEmit`: **0 errors**.

### 2. Implemented but Unverified (Not Yet Tested Against Live Production / Live SMAV)
- **Live PostgreSQL Execution of Migration `024_smav_user_sync_outbox.sql`**: Not yet applied to production Glossy Looks Supabase (`onswigwiwuvkvoduuhxr`); SQL syntax/RPC behavior (`smav_enqueue_user_sync_event`, `smav_claim_due_user_sync_events`, `vw_smav_staff_auth_status`) has not been executed against live Supabase yet.
- **Live End-to-End Handshake Against SMAV Production Gateway**: No live HTTP request has been sent to `POST ${SMAV_GATEWAY_URL}/api/integrations/glossylooks/users/sync`; actual SMAV route path, header validation, payload parsing, and response shape remain unverified against the live SMAV deployment.
- **Live Production Audit of Named Accounts**: Local repo contains only 1 seed user (`Madu Mounika`); the 9 live production Admin Users (**Renuka**, **Madu Mounika**, **SRIKANTH KAYIDAPURAM**, **Sharadha**, **SRIREDDY**, etc.) have not been queried directly against production Supabase yet (read-only audit script created at `database/diagnostics/smav_user_reconciliation_audit.sql`).
- **Incoming Bidirectional Webhook (`POST /api/smav-sync-webhook`)**: Verified statically, not tested end-to-end against live SMAV outbound webhook delivery.

### 3. Not Yet Implemented (In Glossy Looks)
- **HMAC Signature & Timestamp/Replay Protection on User Sync**: Neither outbound `POST /api/integrations/glossylooks/users/sync` nor inbound `POST /api/smav-sync-webhook` computes/verifies HMAC signatures or timestamp replay windows. (Currently uses static shared header `X-Integration-Key`; see Section 2 for exact details and comparison with Stage 3 `sale-event` HMAC.)
- **Single-Transaction Atomicity Between `public.users` Write and Outbox Enqueue**: Currently, `createUser`/`updateUser`/`resetUserPassword` executes in one Supabase PostgREST call, and `smav_enqueue_user_sync_event` executes immediately after in a second RPC call. If the server crashes between those two calls, the user row is saved locally (`central_sync_status = 'PENDING'` on create) without an outbox row until manual Retry Sync or reconciliation runs.
- **Vercel Cron Entry in `vercel.json` for Outbox Draining**: `ALL /api/cron/smav-user-sync-outbox` is implemented in `server.ts`, and a 60s `setInterval` runs on long-lived Node servers (Cloud Run / local), plus opportunistic 30s-throttled draining runs on `GET /api/admin/users`. However, **`vercel.json` does NOT yet include a cron schedule entry** for `/api/cron/smav-user-sync-outbox`.
- **Self-Service / Email Reset-Link Credential Flow**: Password sync currently sends transient `initialPassword` / `newPassword` directly to SMAV rather than triggering a SMAV-generated password-setup/reset email link.

### 4. Requires Confirmation / Changes in SMAV Project
- Confirm whether SMAV's actual `POST /api/integrations/glossylooks/users/sync` endpoint expects **`X-Integration-Key`**, **HMAC-SHA256**, or **both**.
- Confirm whether SMAV accepts the exact action names (`upsert_user`, `update_user`, `set_status`, `reset_password`), field names (`userId`, `externalStaffId`, `fullName`, `isActive`, `initialPassword`, `newPassword`), and role enum values (`ADMIN`, `POS_BILLING`) currently sent by Glossy Looks.
- Confirm SMAV's identity resolution order, duplicate-prevention `409` contract, `X-Idempotency-Key` persistence, `X-SMAV-Sync-Origin: outlet_admin` echo-loop suppression, immediate session/access revocation on `isActive: false`, and `must_change_password: true` behavior on `reset_password`.

---

## 1. API Endpoint URL, HTTP Method & Authentication Mechanism

### Outbound: Glossy Looks → SMAV Central Identity
- **Primary Gateway Mode (when `SMAV_GATEWAY_URL` is set)**:
  - **Method**: `POST`
  - **URL**:
    - If `SMAV_GATEWAY_URL` does **not** end with `/users/sync`:  
      `POST ${SMAV_GATEWAY_URL}/api/integrations/glossylooks/users/sync`
    - If `SMAV_GATEWAY_URL` already ends with `/users/sync`:  
      `POST ${SMAV_GATEWAY_URL}`
  - **Source**: `SmavOutletUserAdapter.resolveTargetUrl()` (`src/server/smav/smav_outlet_user_adapter.ts`, lines 93–101).
- **Fallback Edge Function Mode (ONLY when `SMAV_GATEWAY_URL` is empty/unset)**:
  - **Method**: `POST`
  - **URL Resolution Order**:
    1. `SMAV_EDGE_FUNCTION_URL`
    2. `${SMAV_SUPABASE_URL}/functions/v1/smav-identity-admin`
    3. Hardcoded default fallback: `https://qykdwswatopylzvqhgog.supabase.co/functions/v1/smav-identity-admin`
  - **Warning**: If `SMAV_GATEWAY_URL` is omitted in production, Glossy Looks will silently fall back to the Supabase Edge Function URL and send kebab-case actions (`upsert-user`, `set-status`, `reset-password`). **Always set `SMAV_GATEWAY_URL` in production.**
- **Authentication Mechanism (Current Implementation)**:
  - **Shared static API key header**: `X-Integration-Key: <GLOSSYLOOKS_INTEGRATION_KEY>` paired with `X-Business-Source: glossylooks`.
  - In Edge Function fallback mode only, also attaches `apikey: <SMAV_SUPABASE_ANON_KEY>` if configured.
  - **Timeout**: `15000 ms` via `AbortController`.

### Inbound (Bidirectional Webhook): SMAV → Glossy Looks
- **Method & URL**: `POST https://www.glossylooks.in/api/smav-sync-webhook`
- **Authentication Mechanism**: Timing-safe comparison (`crypto.timingSafeEqual`) of `X-Integration-Key` against `GLOSSYLOOKS_INTEGRATION_KEY` + outlet check (`X-Business-Source` / `body.outletCode` must equal `glossylooks`) + echo-loop guard (skips `200 OK` if `X-SMAV-Sync-Origin` or `body.syncOrigin` is `outlet_admin`).

---

## 2. Required Request Headers & HMAC Signature Analysis

### A. Headers Actually Sent by Glossy Looks on User Sync (`POST /api/integrations/glossylooks/users/sync`)
Source: `SmavOutletUserAdapter.buildHeaders()` (`src/server/smav/smav_outlet_user_adapter.ts`, lines 103–113):

| Header | Required | Value Sent by Glossy Looks | Purpose |
| --- | --- | --- | --- |
| `Content-Type` | Yes | `application/json` | JSON request body |
| `X-Business-Source` | Yes | `glossylooks` | Outlet scope identifier |
| `X-Integration-Key` | Yes | `${GLOSSYLOOKS_INTEGRATION_KEY}` | Shared server-to-server integration secret |
| `X-SMAV-Sync-Origin` | Yes | `outlet_admin` | Echo-loop prevention (SMAV must not echo back to Glossy Looks) |
| `X-Idempotency-Key` | Yes | `gl_<event_type>_<local_user_id>_<epoch_ms>_<12hex>` (or forwarded request header, max 120 chars) | End-to-end idempotency key persisted in `smav_user_sync_outbox` |
| `apikey` | Edge fallback only | `${SMAV_SUPABASE_ANON_KEY}` | Sent **only** when `SMAV_GATEWAY_URL` is unset and `SMAV_SUPABASE_ANON_KEY` is set |

### B. HMAC Signature & Timestamp/Replay Status (IMPORTANT GAP DISCLOSURE)
- **User Sync (`POST /api/integrations/glossylooks/users/sync`)**:
  - **HMAC Signature**: **NOT IMPLEMENTED** in `SmavOutletUserAdapter`. No `X-SMAV-Signature` or `X-SMAV-Timestamp` header is currently generated or transmitted on outbound user sync requests.
  - **Timestamp / Replay Validation**: **NOT IMPLEMENTED** on outbound user sync or inbound `/api/smav-sync-webhook`. Replay protection currently relies exclusively on `X-Idempotency-Key` deduplication.
- **Reference: Existing HMAC Pattern in Glossy Looks Stage 3 Sale Event Receiver (`POST /api/integrations/smav/sale-event`)**:
  - For comparison, Glossy Looks already verifies HMAC-SHA256 on Stage 3 sale events in `verifySmavSaleEvent()` (`server.ts`, lines 119–147):
    - **Headers**: `X-SMAV-Timestamp` (10-digit Unix epoch seconds `/^\d{10}$/`) and `X-SMAV-Signature` (64-char lowercase hex SHA-256 HMAC).
    - **Secret**: `SMAV_DISPATCH_SECRET` (minimum 32 chars).
    - **Replay Window**: `Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300` (±5 minutes).
    - **Exact Signed Bytes (UTF-8)**: `${timestamp}.${rawJsonBody}`
    - **Algorithm**: `crypto.createHmac('sha256', secret).update(`${ts}.${rawText}`).digest('hex')`, compared with `crypto.timingSafeEqual`.
- **Action Needed With SMAV Team**: If SMAV's `POST /api/integrations/glossylooks/users/sync` endpoint requires HMAC-SHA256 + timestamp validation (using either `GLOSSYLOOKS_INTEGRATION_KEY` or a dedicated signing secret), **`SmavOutletUserAdapter.postSync()` must be updated to sign the exact serialized JSON body before live rollout.**

---

## 3. Request JSON Schema & Sample Payloads

### Common Envelope Fields (Gateway Mode: `SMAV_GATEWAY_URL` set)
*(Note: In Edge Function fallback mode only, `action` uses kebab-case `upsert-user` / `set-status` / `reset-password` and `businessSource: "glossylooks"` is also included.)*

| Field | Type | Mandatory | Notes |
| --- | --- | --- | --- |
| `action` | `string` enum | **Yes** | One of: `"upsert_user"`, `"update_user"`, `"set_status"`, `"reset_password"` |
| `syncOrigin` | `string` | **Yes** | Always `"outlet_admin"` |
| `outletCode` | `string` | **Yes** | Always `"glossylooks"` |
| `userId` | `string` (UUID) | Conditional | Present whenever `public.users.central_auth_id` is already linked. Omitted only for unlinked users. |
| `externalStaffId` | `string` (UUID) | **Yes** | Immutable `public.users.id` from Glossy Looks Supabase |
| `email` | `string` | **Yes** | Lowercased, trimmed `public.users.email` |
| `fullName` | `string` | For `upsert_user` / `update_user` | Trimmed `public.users.name` |
| `username` | `string` | Optional | Lowercased `public.users.username` (or fallback `public.users.user_id`, e.g. `tgl-sty09`) |
| `phone` | `string` | For `upsert_user` / `update_user` | Trimmed `public.users.phone` (empty string `""` if blank) |
| `role` | `"ADMIN" \| "POS_BILLING"` | For `upsert_user`, `update_user`, `set_status` | Mapped strictly from `public.users.role` (`owner`/`manager` → `ADMIN`; `stylist`/`receptionist`/`inventory_staff` → `POS_BILLING`) |
| `isActive` | `boolean` | For `upsert_user`, `update_user`, `set_status` | `public.users.is_active` |
| `initialPassword` | `string` (≥ 8 chars) | Optional (`upsert_user` only) | Transient in-memory only during `POST /api/admin/users`; **never stored in outbox** |
| `newPassword` | `string` (≥ 8 chars) | Mandatory (`reset_password` only) | Transient in-memory only during `POST /api/admin/users/:id/reset-password`; **never stored in outbox** |

### Sample Payloads

#### 3.1 Create Staff User (Unlinked New User — e.g. `SRIREDDY`)
```json
{
  "action": "upsert_user",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "externalStaffId": "a1b2c3d4-0000-4000-8000-000000000009",
  "email": "srireddy@theglossylooks.com",
  "fullName": "SRIREDDY",
  "username": "tgl-sty09",
  "phone": "9000011111",
  "role": "POS_BILLING",
  "isActive": true,
  "initialPassword": "<transient-8+-char-password-never-persisted-in-outbox>"
}
```
*(If no password was supplied on creation, `initialPassword` is omitted.)*

#### 3.2 Edit User Profile (Linked User)
```json
{
  "action": "update_user",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "userId": "22222222-2222-4222-8222-222222222222",
  "externalStaffId": "a1b2c3d4-0000-4000-8000-000000000004",
  "email": "sharadha@theglossylooks.com",
  "fullName": "Sharadha Devi",
  "username": "tgl-rec04",
  "phone": "9000022222",
  "role": "POS_BILLING",
  "isActive": true
}
```

#### 3.3 Change Email (UUID Preserved)
*(Glossy Looks enforces that `central_auth_id` is linked BEFORE permitting an email change on `PATCH /api/admin/users/:id` so `userId` is always sent.)*
```json
{
  "action": "update_user",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "userId": "22222222-2222-4222-8222-222222222222",
  "externalStaffId": "a1b2c3d4-0000-4000-8000-000000000004",
  "email": "sharadha.new@theglossylooks.com",
  "fullName": "Sharadha Devi",
  "username": "tgl-rec04",
  "phone": "9000022222",
  "role": "POS_BILLING",
  "isActive": true
}
```

#### 3.4 Change Role (e.g. `receptionist` → `manager` = `ADMIN`)
```json
{
  "action": "update_user",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "userId": "22222222-2222-4222-8222-222222222222",
  "externalStaffId": "a1b2c3d4-0000-4000-8000-000000000004",
  "email": "sharadha.new@theglossylooks.com",
  "fullName": "Sharadha Devi",
  "username": "tgl-rec04",
  "phone": "9000022222",
  "role": "ADMIN",
  "isActive": true
}
```

#### 3.5 Deactivate User (Prompt Access Revocation)
```json
{
  "action": "set_status",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "userId": "33333333-3333-4333-8333-333333333333",
  "externalStaffId": "a1b2c3d4-0000-4000-8000-000000000002",
  "email": "srikanth@theglossylooks.com",
  "role": "ADMIN",
  "isActive": false
}
```

#### 3.6 Reactivate User (Restores Appropriate Outlet Permissions Only)
*(Uses `update_user` if `userId` is linked or `upsert_user` if unlinked, carrying exact mapped `role` + `isActive: true`.)*
```json
{
  "action": "update_user",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "userId": "33333333-3333-4333-8333-333333333333",
  "externalStaffId": "a1b2c3d4-0000-4000-8000-000000000002",
  "email": "srikanth@theglossylooks.com",
  "fullName": "SRIKANTH KAYIDAPURAM",
  "username": "tgl-mgr02",
  "phone": "9000033333",
  "role": "POS_BILLING",
  "isActive": true
}
```

#### 3.7 Reset Password (Transient Server-Side Credential Sync)
```json
{
  "action": "reset_password",
  "syncOrigin": "outlet_admin",
  "outletCode": "glossylooks",
  "userId": "44444444-4444-4444-8444-444444444444",
  "externalStaffId": "00000000-0000-0000-0000-000000000001",
  "email": "owner@theglossylooks.com",
  "newPassword": "<transient-8+-char-password-never-persisted-in-outbox>"
}
```

---

## 4. Expected Success / Error Responses, HTTP Status Codes & Retry Behavior

### Expected Success Response Shape (Parsed by `SmavOutletUserAdapter.postSync`)
- **HTTP Status**: `200 OK` or `201 Created` (`res.ok === true` AND `data.success !== false` AND `!data.conflict`).
- **UUID Extraction Precedence** (any of these keys is accepted):
  1. `data.userId`
  2. `data.centralAuthId`
  3. `data.central_auth_id`
  4. `data.user.id`
  5. `data.results[0].userId`
  6. `data.results[0].centralAuthId`
- **Other Recognized Fields**: `success`, `message`, `email` (or `user.email`), `username` (or `user.username`), `role` (or `user.role`), `isNewUser`, `mustChangePassword`, `conflict`.
- **Fail-Closed Check**:
  - For `upsert_user` / `update_user`, if SMAV returns `200` for an unlinked user **without** any Central Auth UUID, Glossy Looks marks the outbox & user **`FAILED`** (never silently `SYNCED`).
  - If SMAV returns a `userId` that differs from the user's already-linked `public.users.central_auth_id`, Glossy Looks rejects the overwrite, marks **`FAILED`** (`conflict: true`), and preserves the existing UUID.

Example `200 OK` response expected from SMAV:
```json
{
  "success": true,
  "userId": "11111111-1111-4111-8111-111111111111",
  "email": "srireddy@theglossylooks.com",
  "username": "tgl-sty09",
  "role": "POS_BILLING",
  "isNewUser": true,
  "mustChangePassword": true,
  "message": "User synchronized"
}
```

### Error Responses & Retry Classification

| Condition / HTTP Status | Retryable? | Glossy Looks Outbox & User State | Behavior |
| --- | --- | --- | --- |
| Network error / DNS / TCP failure | **Yes** | `PENDING` (until `attempts >= 6`, then `FAILED`) | Automatic exponential backoff retry |
| `408 Request Timeout` / 15s `AbortController` timeout | **Yes** | `PENDING` (until `attempts >= 6`, then `FAILED`) | Automatic exponential backoff retry |
| `429 Too Many Requests` | **Yes** | `PENDING` (until `attempts >= 6`, then `FAILED`) | Automatic exponential backoff retry |
| `500`–`599` Server / Gateway errors | **Yes** | `PENDING` (until `attempts >= 6`, then `FAILED`) | Automatic exponential backoff retry |
| `409 Conflict` or `body.conflict === true` | **No** | `FAILED` (`conflict: true`) | Preserved for manual reconciliation; never auto-retried |
| `400`, `401`, `403`, `404`, `422` (other 4xx) | **No** | `FAILED` | Preserved for investigation & manual Owner Retry Sync |
| `GLOSSYLOOKS_INTEGRATION_KEY` unset | **No** | `FAILED` (synthetic `503`) | Fails closed with clear error |
| **Any failure on `action: "reset_password"`** | **No** | `FAILED` (`passwordResetRequired: true`) | **Never auto-retried** because passwords are never persisted in the outbox; Owner must re-run Reset Password |

Example `409 Conflict` response expected from SMAV on ambiguous identity:
```json
{
  "success": false,
  "conflict": true,
  "message": "Email already belongs to another Central Auth UUID; manual reconciliation required."
}
```

---

## 5. Source Glossy Looks Database Tables, Immutable IDs & UUID Mapping

### Primary Authoritative Table: `public.users` (Glossy Looks Supabase)
- **Immutable Primary Key**: `public.users.id` (`UUID`, sent to SMAV as `externalStaffId`).
- **Human-Readable Login Code**: `public.users.user_id` (`VARCHAR(50)`, unique, e.g. `TGL-OWN01`, `TGL-MGR01`) and `public.users.username` (`TEXT`).
- **Authoritative RBAC Role**: `public.users.role` (`CHECK IN ('owner', 'manager', 'receptionist', 'stylist', 'inventory_staff')`).
- **Central Identity Link & Sync Columns** (ensured by Migration `024`):
  - `central_auth_id UUID` — 1:1 link to Central SMAV `auth.users.id` (guarded unique partial index `uq_users_central_auth_id WHERE central_auth_id IS NOT NULL`, created automatically only if no legacy duplicate exists).
  - `central_auth_status TEXT` (`'ACTIVE'` / `'DISABLED'`)
  - `central_auth_linked_at TIMESTAMPTZ`
  - `central_outlet_code TEXT DEFAULT 'glossylooks'`
  - `central_sync_version BIGINT DEFAULT 1`
  - `central_last_synced_at TIMESTAMPTZ`
  - `central_sync_origin TEXT DEFAULT 'outlet_admin'`
  - `central_sync_status TEXT CHECK IN ('SYNCED', 'PENDING', 'FAILED')`
  - `central_sync_error TEXT` (sanitized safe message, max 320 chars)
  - `central_sync_last_attempt_at TIMESTAMPTZ`
  - `central_sync_outbox_id UUID`

### Secondary Operational Table: `public.staff`
- Linked via `public.staff.user_id -> public.users(id)` (`ON DELETE CASCADE`).
- `public.staff.role` holds free-text salon job titles (e.g. `"Senior Beautician"`, `"Hair Stylist"`) and is **never** used to determine SMAV roles.
- Sync metadata columns (`central_auth_id`, `central_sync_status`, `central_sync_error`, etc.) are mirrored onto `public.staff` for reporting consistency, and `public.vw_smav_staff_auth_status` is anchored on `public.users LEFT JOIN public.staff`.

### Durable Outbox Table: `public.smav_user_sync_outbox`
- RLS enabled; privileges granted strictly to `service_role` (`REVOKE ALL` from `PUBLIC, anon, authenticated`).
- Key columns: `id (UUID PK)`, `idempotency_key (TEXT UNIQUE)`, `local_user_id (UUID FK -> public.users.id)`, `event_type`, `action`, `payload (JSONB)`, `status ('PENDING' | 'PROCESSING' | 'SYNCED' | 'FAILED')`, `attempts`, `max_attempts`, `next_retry_at`, `locked_at`, `last_http_status`, `last_error`, `conflict`, `response_central_auth_id`, `performed_by`, `created_at`, `updated_at`, `synced_at`.
- **Database Secret Guard**: `CHECK` constraint `chk_smav_outbox_no_plaintext_secrets` rejects any `payload` containing keys `password`, `initialPassword`, `initial_password`, `newPassword`, `new_password`, `password_hash`, `resetToken`, `reset_token`, or `secret`.

---

## 6. Exact Modified & Created Files and Database Migrations

### Created Files
| File | Purpose |
| --- | --- |
| `database/migrations/024_smav_user_sync_outbox.sql` | Non-destructive schema migration: `public.users` & `public.staff` sync columns, guarded unique index, `public.smav_user_sync_outbox` table + secret `CHECK`, RPCs `smav_enqueue_user_sync_event` & `smav_claim_due_user_sync_events`, updated view `vw_smav_staff_auth_status` |
| `database/diagnostics/smav_user_reconciliation_audit.sql` | Read-only `SELECT` diagnostics for Glossy Looks Supabase and Central SMAV Supabase targeting all users + named accounts (Renuka, Madu Mounika, SRIKANTH KAYIDAPURAM, Sharadha, SRIREDDY) |
| `scripts/test-smav-user-sync.ts` | Offline mocked verification suite (10 test cases; zero live DB/network calls) |

### Modified Files
| File | Summary of Changes |
| --- | --- |
| `src/types/salon.ts` | Added `SmavSyncStatus`, `SmavOutletRole`, `SmavUserSyncEventType`, `SmavUserSyncAction`, `SmavUserSyncOutboxItem`, and sync fields on `User` |
| `src/server/smav/smav_outlet_user_adapter.ts` | Fixed gateway URL path to `/api/integrations/${outletCode}/users/sync`, added 15s timeout, retryable HTTP classification, optional `role` on `setUserStatus`, injectable `fetchImpl` |
| `src/server/smav/glossylooks_smav_auth_adapter.ts` | Forwarded `fetchImpl` & `timeoutMs` constructor options |
| `src/server/repositories/salonRepository.ts` | Added durable outbox interface methods |
| `src/server/db.ts` | Implemented outbox methods in local JSON repository fallback |
| `src/server/repositories/supabaseSalonRepository.ts` | Implemented Supabase RPC-backed outbox methods with graceful pre-migration fallback; replaced hardcoded plaintext staff seed password with scrypt-hashed random secret |
| `src/server/smavSync.ts` | Implemented RBAC role mapping (`ADMIN`/`POS_BILLING`), payload/error sanitization, `enqueueAndProcessUserSync`, `processPendingSmavUserSyncOutbox`, `triggerNonBlockingOutboxDrain`, `retrySmavSyncForUser`, `reconcileAdminUsersToSmav`, and updated wrapper exports + incoming webhook |
| `server.ts` | Wired outbox-backed sync on Admin Users routes, enforced `>= 8` char passwords, added Owner-only `POST /api/admin/users/:id/retry-smav-sync`, `GET /api/admin/users/smav-outbox`, `POST /api/admin/users/reconcile-smav`, `ALL /api/cron/smav-user-sync-outbox`, 60s background timer (non-Vercel), and 30s-throttled opportunistic drain |
| `src/lib/api.ts` | Added `SmavSyncClientResult`, `SmavReconciliationUserAudit`, `SmavReconciliationReport`, typed `smavSync` returns, `retryAdminUserSmavSync`, `reconcileAdminUsersSmav` |
| `src/components/admin/AdminPortal.tsx` | Added `SMAV Sync` status column, **Retry Sync** action, **Audit & Reconcile SMAV** dry-run/apply modal, status-aware toasts, and `minLength={8}` password validation |
| `.env.example` | Documented `SMAV_GATEWAY_URL` and `CRON_SECRET` |

---

## 7. Environment Variable Names & Configuration Locations

*(No secret values are revealed.)*

| Variable Name | Required | Where Configured | Purpose |
| --- | --- | --- | --- |
| `SMAV_GATEWAY_URL` | **Yes (Recommended)** | Glossy Looks Vercel / Cloud Run (server-only) | Base URL of SMAV backend hosting `POST /api/integrations/glossylooks/users/sync` |
| `GLOSSYLOOKS_INTEGRATION_KEY` | **Yes** | **Both** Glossy Looks backend AND SMAV backend (must match exactly; server-only) | Shared authentication secret sent in `X-Integration-Key` |
| `CRON_SECRET` | **Yes (on Vercel)** | Glossy Looks Vercel (server-only) | Authorizes `Authorization: Bearer <CRON_SECRET>` calls to `/api/cron/smav-user-sync-outbox` |
| `SMAV_SUPABASE_URL` | Fallback only | Glossy Looks backend (server-only) | Used only when `SMAV_GATEWAY_URL` is unset to build Edge Function fallback URL |
| `SMAV_SUPABASE_ANON_KEY` | Fallback only | Glossy Looks backend (server-only) | Attached as `apikey` header only in Edge Function fallback mode |
| `SMAV_EDGE_FUNCTION_URL` | Optional fallback | Glossy Looks backend (server-only) | Explicit Edge Function URL override if `SMAV_GATEWAY_URL` is unset |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Glossy Looks backend (server-only) | Glossy Looks Supabase access (required for `service_role` outbox RPCs) |
| `SALON_SESSION_SECRET` | **Yes** | Glossy Looks backend (server-only) | Existing Owner session token signing |
| `SMAV_DISPATCH_SECRET` | Separate flow | Both backends (Stage 3 sale events only) | Existing HMAC secret for `POST /api/integrations/smav/sale-event` (not currently used by User Sync) |

---

## 8. Durable Outbox, Retry, Idempotency & Sync-Status Behavior

1. **Enqueue & Immediate Attempt**:
   - Every authorized Admin User action (`USER_CREATED`, `USER_UPDATED`, `EMAIL_CHANGED`, `ROLE_CHANGED`, `USER_ACTIVATED`, `USER_DEACTIVATED`, `PASSWORD_RESET`, `RECONCILE_USER`) builds a sanitized payload (zero passwords/secrets), calls `smav_enqueue_user_sync_event` (which atomically inserts the outbox row and marks `public.users.central_sync_status = 'PENDING'`), transitions the row to `PROCESSING`, and immediately attempts delivery to SMAV.
   - *Transactionality Nuance*: `public.users` CRUD write and `smav_enqueue_user_sync_event` execute as two sequential Supabase calls (not a single DB transaction).
2. **Idempotency**:
   - `public.smav_user_sync_outbox.idempotency_key` has a `UNIQUE` constraint.
   - Re-submitting an existing key whose row is `SYNCED` returns `{ synced: true, syncStatus: 'SYNCED', status: 'idempotent_replay' }` without issuing another HTTP call.
   - Re-submitting a key currently `PROCESSING` returns `{ synced: false, syncStatus: 'PENDING', status: 'processing' }`.
   - Every outbound retry re-sends the exact same `X-Idempotency-Key` header.
3. **Exponential Backoff & Automatic Processing**:
   - Retry delays after transient failures (`408`, `429`, `5xx`, network error): **`30s → 2m → 10m → 30m → 2h`** (`max_attempts = 6`).
   - Claiming uses `smav_claim_due_user_sync_events` with `FOR UPDATE SKIP LOCKED`, skips `action = 'reset_password'`, and reclaims stale `PROCESSING` locks older than **5 minutes**.
   - **Automatic Triggers**:
     - Long-running Node (Cloud Run / local): `setInterval` every `60s` in `startServer()`.
     - Serverless (Vercel): opportunistic background drain (30s throttle) on `GET /api/admin/users`, plus dedicated cron endpoint `ALL /api/cron/smav-user-sync-outbox` (requires cron schedule configuration).
4. **Sync Status Lifecycle (`public.users.central_sync_status`)**:
   - `SYNCED`: Confirmed by SMAV with matching/linked `central_auth_id`; `central_sync_error` cleared.
   - `PENDING`: Transient failure queued with `next_retry_at` set, or user not yet synced.
   - `FAILED`: Permanent 4xx / `409 Conflict` / UUID mismatch / exhausted retries / failed `reset_password`. Preserved in DB and surfaced in Admin UI with safe error detail and an Owner-only **Retry Sync** action (`POST /api/admin/users/:id/retry-smav-sync`).

---

## 9. Assumptions About the Existing SMAV API Requiring Confirmation

Please verify each of the following against the actual SMAV AI Studio project codebase before live deployment:

1. **Exact Route Mounting**: Does SMAV actually expose `POST /api/integrations/glossylooks/users/sync` (or `/api/integrations/:outletCode/users/sync`) on `SMAV_GATEWAY_URL`?
2. **Authentication Scheme**: Does SMAV validate `X-Integration-Key` + `X-Business-Source: glossylooks`, OR does SMAV require **HMAC-SHA256 (`X-SMAV-Timestamp` + `X-SMAV-Signature`)**? *(If HMAC is required, Glossy Looks must add signing to `SmavOutletUserAdapter` before rollout.)*
3. **Action & Field Names**: Does SMAV accept `action: "upsert_user" | "update_user" | "set_status" | "reset_password"` and camelCase fields (`userId`, `externalStaffId`, `fullName`, `isActive`, `initialPassword`, `newPassword`, `syncOrigin`, `outletCode`)?
4. **Role Enum Values**: Does SMAV accept `"ADMIN"` and `"POS_BILLING"` strictly for Glossy Looks users and enforce outlet-scoped access (without granting unrelated outlet/platform roles on reactivation)?
5. **Identity Resolution & Duplicate Prevention**: Does SMAV resolve in strict order:
   1. `userId` (Central Auth UUID)
   2. `(source='glossylooks', external_id=externalStaffId)`
   3. Exact lowercase `email`  
   and return HTTP **`409`** with `{ success: false, conflict: true, message }` whenever identity signals disagree (e.g., Renuka's mismatch), rather than creating a duplicate `auth.users` account?
6. **Idempotency Store on SMAV**: Does SMAV deduplicate incoming `X-Idempotency-Key` values and return the original `userId` on replay?
7. **Echo Loop Prevention**: Does SMAV suppress outbound webhooks back to Glossy Looks (`/api/smav-sync-webhook`) when `X-SMAV-Sync-Origin: outlet_admin` or `body.syncOrigin === "outlet_admin"`?
8. **Deactivation & Password Reset Semantics**:
   - Does `set_status` (`isActive: false`) immediately block/ban Central Auth login and revoke outlet membership/sessions?
   - Does `reset_password` update the user's Central Auth password securely and set `must_change_password: true` (or does SMAV prefer a reset-link/token flow instead)?
9. **Response UUID Field**: Does SMAV always return `userId` (or `centralAuthId` / `user.id`) on `upsert_user` / `update_user` success?

---

## 10. Deployment Instructions, Rollback Plan & Remaining Work

### Deployment Steps (Do NOT Execute Until Section 9 Is Confirmed With SMAV)
1. **Confirm / Align Contract With SMAV**: Resolve all items in Section 9 (especially auth mechanism: `X-Integration-Key` vs HMAC).
2. **Apply Database Migration (Non-Destructive)**:
   - Run `database/migrations/024_smav_user_sync_outbox.sql` in Glossy Looks Supabase SQL Editor (`onswigwiwuvkvoduuhxr`).
   - Check notices: if `uq_users_central_auth_id` was skipped due to existing duplicate `central_auth_id` values, resolve duplicates before creating the unique index.
3. **Configure Environment Variables**:
   - In Glossy Looks Vercel / Cloud Run: set `SMAV_GATEWAY_URL`, `GLOSSYLOOKS_INTEGRATION_KEY` (matching SMAV), and `CRON_SECRET`.
4. **Configure Scheduled Outbox Drain (If Hosted on Vercel)**:
   - Add a 1–5 minute cron job calling `GET /api/cron/smav-user-sync-outbox` with `Authorization: Bearer <CRON_SECRET>` (either in `vercel.json` or an external scheduler).
5. **Deploy Glossy Looks Application**: Push to GitHub / redeploy Vercel (and Cloud Run if applicable).
6. **Run Read-Only Production Audit First**:
   - Execute `database/diagnostics/smav_user_reconciliation_audit.sql` against Glossy Looks Supabase and Central SMAV Supabase.
   - Review exact rows for **Renuka**, **Madu Mounika**, **SRIKANTH KAYIDAPURAM**, **Sharadha**, **SRIREDDY**, and the remaining accounts.
7. **Run Safe Reconciliation From Admin Portal**:
   - Open **Settings → Admin Users & Security → Audit & Reconcile SMAV** (executes `dryRun: true`).
   - Verify **Renuka** (or any conflicted account) is flagged `NEEDS_MANUAL_REVIEW`.
   - Click **Sync Safe Accounts** (skips ambiguous accounts automatically).
   - Manually resolve Renuka's verified Central Auth UUID based on the SQL audit, then click **Retry Sync** on her row.

### Rollback Plan
- **Application Rollback**: Revert/redeploy the previous Glossy Looks Vercel/Cloud Run release. All existing login, RBAC, POS billing, appointments, and WhatsApp routes remain backward compatible.
- **Database Rollback**: Migration `024` is strictly additive (`ADD COLUMN IF NOT EXISTS`, new table `public.smav_user_sync_outbox`, new RPCs, and updated view `vw_smav_staff_auth_status`) and does **not** alter existing `public.users` rows' emails, roles, statuses, or `password_hash`. No destructive rollback is required; optionally pause outbound retries by unsetting `SMAV_GATEWAY_URL` / pausing the cron job.

### Remaining Work Before Production Cutover
1. Verify SMAV's actual `POST /api/integrations/glossylooks/users/sync` implementation against Section 9.
2. If SMAV requires HMAC-SHA256 + timestamp replay validation on User Sync, implement matching request signing in `SmavOutletUserAdapter` (and verification on `/api/smav-sync-webhook`).
3. Add `/api/cron/smav-user-sync-outbox` schedule to `vercel.json` (if deploying on Vercel Pro/cron-enabled plan) or configure an external authenticated cron ping.
4. Run `database/diagnostics/smav_user_reconciliation_audit.sql` on live databases to resolve **Renuka**'s identity mismatch and verify the 9 Glossy Looks users vs 6 SMAV users before applying reconciliation.
