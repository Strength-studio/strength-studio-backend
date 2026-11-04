# PostgreSQL and Prisma data dictionary

Status: proposed Milestone 0 contract. The [ERD](domain-model.md) shows major relationships. This dictionary also specifies actor, policy, and self-referencing edges.

## Conventions

Every entity has required UUID id as primary key and required created_at timestamptz unless another primary key is named. A question mark marks nullable. Other fields are required. An arrow denotes an FK. An FK is many-to-one, a nullable FK permits zero or one parent, and a unique FK permits at most one dependent per parent. Domain and history FKs use ON DELETE RESTRICT. Archive, revoke, retire, or compensate. Purge only approved ephemeral auth, request retry, and delivery data after dependency and replay windows.

Types: u = uuid, ts = timestamptz, i = integer, b = boolean, s = text, d = date, j = validated JSONB, bytes = bytea, m = numeric(19,4), c = validated three-letter currency code, e = closed enum. Store UTC instants and use an approved IANA studio timezone for local business boundaries. Validate enabled currencies and allowed precision before storing. Serialize money as decimal strings with currency.

Scope means required account_id:u and currency:c with composite FK to FINANCE_ACCOUNT. UQ is unique, IX is an index. Index FK columns unless a suitable leading index already exists. See the [scoped FK and ownership map](#scoped-foreign-keys-and-ownership) for exact keys and checks.

Prisma owns migration history. Use reviewed SQL for exclusion, partial uniqueness, runtime privileges, and constraints outside the selected Prisma version. Row-local conditions can be CHECK constraints. Conditions spanning rows require composite keys, a locked write path, or both. Append immutable posting and history rows. Audit consequential mutations in the same transaction. Commission audit stays private.

## Identity, policy, and catalog

| Entity and purpose | Fields | Keys, checks, and indexes |
|---|---|---|
| USER · identity | normalized_email:s, role:e, account_state:e, password_hash:s?, email_verified_at:ts? | UQ email. Roles Admin, Staff, Coach, Client. Self-registration Client only. Disablement revokes access. |
| CLIENT_PROFILE · client scope | user_id:u → USER as PK, display_name:s | One profile per user. Require compatible role. |
| COACH_PROFILE · assignment scope | user_id:u → USER as PK, display_name:s | One profile per user. Require compatible role. Staff use USER and grants. |
| STAFF_GRANT · delegated action | staff_user_id:u → USER, permission:e, changed_by:u → USER, revoked_at:ts? | UQ staff/permission. Default absent. Enum contains only the grantable values in the [permission matrix](permission-matrix.md). Grant writers lock the affected USER before changing the grant. |
| AUTH_SESSION · revocable sign-in | user_id:u → USER, expires_at:ts, revoked_at:ts? | UQ ID/user. IX user/revocation/expiry. Revocation terminal. Session writes follow the [shared command transaction](business-rules.md#shared-command-transaction). |
| AUTH_TOKEN · invite, verification, reset, refresh or socket credential | user_id:u → USER, session_id:u? → AUTH_SESSION, purpose:e, digest:s, expires_at:ts, consumed_at:ts? | UQ digest. IX user/purpose/expiry. Refresh/socket require matching session owner. Consume atomically. Retain consumed refresh digests through replay window. |
| STUDIO_SETTINGS · stable settings lock | singleton_key:s, active_policy_id:u? → POLICY_REVISION | UQ singleton key. Active revision must belong to this studio via composite FK. |
| POLICY_REVISION · approved settings | studio_id:u → STUDIO_SETTINGS, version:i, effective_at:ts, approved_by:u → USER, timezone:s, default_currency:c, rules:j | UQ studio/version and ID/studio. Validate timezone and rule schema. Approved rows immutable. Unresolved values remain unset. |
| PACKAGE · catalog identity | code:s, visibility:e, client_id:u? → CLIENT_PROFILE, archived_at:ts? | UQ code. Private requires client. Public prohibits client. Archive preserves references. |
| PACKAGE_VERSION · immutable published terms | package_id:u → PACKAGE, based_on_version_id:u? → PACKAGE_VERSION, version:i, name:s, description:s, price:m, currency:c, membership_kind:e, validity_days:i, session_allowance:i?, published_at:ts?, superseded_at:ts? | UQ package/version and partial UQ one current published version. Nonnegative price, positive validity, positive allowance for session packages. Freeze business fields and eligibility on publish. |
| SESSION_TYPE · individual or group type | code:s, name:s, mode:e, archived_at:ts? | UQ code. Protect historical mode. |
| PACKAGE_VERSION_SESSION_TYPE · eligibility | package_version_id:u → PACKAGE_VERSION, session_type_id:u → SESSION_TYPE | Composite PK over both FKs. Reverse IX on session type. Freeze published links. |

## Commercial, finance, and entitlement

| Entity and purpose | Fields | Keys, checks, and indexes |
|---|---|---|
| FINANCE_ACCOUNT · client and currency lock | client_id:u → CLIENT_PROFILE, currency:c | UQ client/currency and ID/currency. Balance is derived. |
| PURCHASE_REQUEST · exact proposed version | client_id:u → CLIENT_PROFILE, package_version_id:u → PACKAGE_VERSION, state:e, decided_by:u? → USER, decided_at:ts?, reason:s? | IX client/state/time. Decision requires actor and time. Check private visibility and exact offer. |
| PURCHASE · agreed receivable | scope, request_id:u? → PURCHASE_REQUEST, recorded_by:u → USER, agreed_total:m | UQ nullable request and ID/currency. IX account/time. Require one or more matching items and totals at recording. Positive receivable posts atomically. Zero-price issuance requires approved policy. |
| PURCHASE_ITEM · agreed snapshot | purchase_id:u → PURCHASE, package_version_id:u → PACKAGE_VERSION, line_no:i, description_snapshot:s, agreed_amount:m, currency:c, validity_days_snapshot:i, session_allowance_snapshot:i? | UQ purchase/line. Match purchase currency. Immutable. Use published version for membership kind and eligible session types. |
| INSTALLMENT · scheduled receivable portion | scope, purchase_id:u → PURCHASE, sequence:i, due_on:d, scheduled_amount:m, replaces_id:u? → INSTALLMENT, retired_at:ts? | Partial UQ active purchase/sequence. UQ nullable replacement and ID/purchase/scope. IX due date/retirement. Positive amount. Resolve allocations before retirement. |
| PAYMENT · original manual receipt | scope, reported_amount:m, received_at:ts, method:e, external_ref:s?, recorded_by:u → USER, corrects_id:u? → PAYMENT, verification_event_id:u? → FINANCE_EVENT | UQ nullable correction and verification references. IX account/receipt time. Positive amount. Facts immutable. Verification pointer set once. |
| CREDIT_LOT · original funding source | scope, source_payment_id:u? → PAYMENT, origin_kind:e | UQ nullable source payment and ID/source-payment/scope. Cash-backed origin requires payment. One origin posting per lot. |
| FINANCE_EVENT · immutable posting and allocation join | scope, kind:e, amount:m, effective_at:ts, posted_by:u → USER, posting_key:s, posting_digest:s, lot_id:u? → CREDIT_LOT, purchase_id:u? → PURCHASE, installment_id:u? → INSTALLMENT, refund_id:u? → REFUND, source_bucket:e?, target_bucket:e?, reverses_event_id:u? → FINANCE_EVENT, reason:s? | UQ account/posting key. Partial UQ one origin per lot and one posted refund per refund. IX account, lot, purchase and installment with effective time, plus refund and reversal refs. Positive amount. Kind-specific references. Append-only. |
| REFUND · request, reserve, and execution | scope, payment_id:u → PAYMENT, lot_id:u → CREDIT_LOT, requested_amount:m, approved_amount:m?, kind:e, state:e, requested_by:u → USER, reason:s, decided_by:u? → USER, decided_at:ts?, execution_by:u? → USER, execution_at:ts?, execution_evidence_ref:s? | IX payment/state and lot/state. Positive amounts and approval ≤ request. Reserve needs approval. Execution needs actor/time. Posting requires evidence and one matching terminal event. |
| MEMBERSHIP · lifecycle and validity | purchase_item_id:u → PURCHASE_ITEM, client_id:u → CLIENT_PROFILE, lifecycle_state:e, starts_at:ts?, valid_until:ts? | UQ purchase item and ID/client. IX client/state/validity. Check purchase ownership. Activation requires validity bounds. |
| MEMBERSHIP_EVENT · authorization and history | membership_id:u → MEMBERSHIP, actor_id:u → USER, policy_id:u → POLICY_REVISION, kind:e, effective_at:ts, reason:s?, funding_basis:e?, funding_event_id:u? → FINANCE_EVENT, verified_funding_snapshot:m?, funding_currency:c?, previous_valid_until:ts?, new_valid_until:ts?, grace_until:ts?, review_id:u? → ENTITLEMENT_REVIEW | IX membership/time. Partial UQ activation. Activation requires verified funding evidence, amount and currency snapshot, or explicit Admin exception with reason. Match funding to purchase. Kind-specific validity fields. Immutable. |
| ENTITLEMENT_REVIEW · separate refund effect | refund_id:u → REFUND, membership_id:u → MEMBERSHIP, state:e, outcome:e?, reason:s?, decided_by:u? → USER, decided_at:ts? | UQ refund/membership. Validate client and applicable purchase. Resolve once with reason and outcome. |
| ENTITLEMENT_ENTRY · immutable signed session units | membership_id:u → MEMBERSHIP, units_delta:i, kind:e, verification_id:u? → ATTENDANCE_VERIFICATION, membership_event_id:u? → MEMBERSHIP_EVENT, review_id:u? → ENTITLEMENT_REVIEW, reverses_entry_id:u? → ENTITLEMENT_ENTRY | IX membership/time. Exactly one authorization source and UQ each source. Nonzero delta. Full reversal matches membership and offsets original units, once per original. |

Finance kind checks require a lot, source bucket, and purchase for allocation, with optional installment. Reversal requires original event and matching scope and target. Conversion needs distinct buckets in one lot. Refund posting requires the refund and reserved lot and bucket. Charge or receivable adjustment needs a purchase. Corrections need reasons. Runtime roles cannot edit or delete posted finance or entitlement entries. Account locks enforce cumulative limits.

## Scheduling and attendance

| Entity and purpose | Fields | Keys, checks, and indexes |
|---|---|---|
| COACH_AVAILABILITY · available window or time off | coach_id:u → COACH_PROFILE, kind:e, starts_at:ts, ends_at:ts, state:e, submitted_by:u → USER, decided_by:u? → USER, decided_at:ts? | IX coach/state/start/end. Positive duration. Decision requires actor and timestamp. |
| SESSION_SLOT · shared bookable session | session_type_id:u → SESSION_TYPE, starts_at:ts, ends_at:ts, capacity:i, state:e, review_required:b | IX state/start and type/start. Positive duration and capacity. Individual capacity one. Protect occupied and historical times. |
| COACH_RESERVATION · buffered assignment history | coach_id:u → COACH_PROFILE, slot_id:u → SESSION_SLOT, occupied_from:ts, occupied_until:ts, buffer_before_seconds:i, buffer_after_seconds:i, released_at:ts? | Partial UQ active slot. GiST exclusion for equal coach and overlapping active half-open ranges. Nonnegative buffers and validated endpoints. |
| BOOKING_PARTICIPANT · booking ID and seat | client_id:u → CLIENT_PROFILE, membership_id:u → MEMBERSHIP, slot_id:u? → SESSION_SLOT, policy_id:u → POLICY_REVISION, state:e, requested_by:u → USER, preferred_start_at:ts?, preferred_coach_id:u? → COACH_PROFILE, hold_expires_at:ts?, waitlist_joined_at:ts?, waitlist_expires_at:ts?, confirmed_at:ts? | Composite membership/client FK. Partial UQ slot/client for held, confirmed and waitlisted. IX slot/state/expiry and client/state/slot. Held requires slot and expiry. Confirmed requires slot and timestamp. Waitlisted requires slot and join time. |
| BOOKING_CHANGE · cancellation or reschedule request | participant_id:u → BOOKING_PARTICIPANT, kind:e, original_slot_id:u → SESSION_SLOT, target_slot_id:u? → SESSION_SLOT, state:e, requested_by:u → USER, decided_by:u? → USER, decided_at:ts?, reason:s? | Partial UQ one pending change per participant. IX state/time. Approved move requires target. Preserve original slot. |
| ATTENDANCE · stable participant history | participant_id:u → BOOKING_PARTICIPANT, served_reservation_id:u → COACH_RESERVATION | UQ participant. Served reservation must match served slot. Create with first revision. |
| ATTENDANCE_REVISION · immutable submission or correction | attendance_id:u → ATTENDANCE, revision:i, submitted_by:u → USER, outcome:e, submitted_at:ts, policy_id:u → POLICY_REVISION, deadline_at:ts?, supersedes_id:u? → ATTENDANCE_REVISION, reason:s? | UQ attendance/revision. Same-parent supersession. Late derives from deadline. Admin correction requires reason. |
| ATTENDANCE_VERIFICATION · Admin decision | revision_id:u → ATTENDANCE_REVISION, decided_by:u → USER, policy_id:u → POLICY_REVISION, decision:e, accepted_charge_units:i?, decided_at:ts, reason:s? | UQ revision. Accepted requires nonnegative units, including zero. Returned requires reason and null units. Reject stale revisions. Latest accepted result remains effective. |

## Delivery, audit, and commissions

| Entity and purpose | Fields | Keys, checks, and indexes |
|---|---|---|
| NOTIFICATION · in-app inbox | recipient_id:u → USER, kind:e, safe_payload:j, dedup_key:s, read_at:ts? | UQ recipient/key and ID/recipient. IX recipient/time. Recipient scoped. No commission data. |
| OUTBOX_EVENT · durable delivery intent | recipient_id:u → USER, notification_id:u? → NOTIFICATION, channel:e, kind:e, dedup_key:s, payload:j, encrypted_secret:bytes?, secret_expires_at:ts?, state:e, next_attempt_at:ts, lease_token:u?, lease_until:ts?, completed_at:ts? | UQ key. IX state/next attempt and state/lease expiry. Lease fields set together. Match notification recipient. Put only safe references in payload. Token-bearing email uses optional ciphertext with an expiry, cleared on completion or expiry. |
| DELIVERY_ATTEMPT · provider outcome | outbox_id:u → OUTBOX_EVENT, attempt_no:i, started_at:ts, outcome:e, finished_at:ts?, provider_reference:s?, safe_error_code:s? | UQ outbox/attempt. Record final or uncertain outcome. No secrets. |
| AUDIT_LOG · operational history | actor_id:u? → USER, action:e, target_type:e, target_id:u, request_id:s?, reason:s?, redacted_details:j | IX target/time and request ID. Typed target is a reference, not a polymorphic FK. Null actor for system events. Append-only. |
| COMMISSION_RECORD · manual earning or adjustment | coach_id:u → COACH_PROFILE, recorded_by:u → USER, period_start:d, period_end:d, kind:e, amount:m, currency:c, reason:s, related_record_id:u? → COMMISSION_RECORD | IX coach/period. Valid period and positive amount. Kind determines effect. Private and append-only. |
| COMMISSION_DISTRIBUTION · recorded manual payout | commission_record_id:u → COMMISSION_RECORD, recorded_by:u → USER, effective_at:ts, kind:e, amount:m, currency:c, posting_key:s, external_ref:s?, reverses_id:u? → COMMISSION_DISTRIBUTION | UQ posting key. IX record/time. Match currency and cap net distributions under record lock. Preserve originals. |
| COMMISSION_AUDIT_LOG · private history and export access | actor_id:u → USER, action:e, commission_record_id:u? → COMMISSION_RECORD, distribution_id:u? → COMMISSION_DISTRIBUTION, request_id:s?, redacted_details:j | IX actor/time and target/time. Nullable targets support list/export events. Restricted and append-only. |
| IDEMPOTENCY_KEY · retry outcome | actor_id:u → USER, operation:s, key:s, request_digest:s, expires_at:ts, result_status:i?, result_reference:s? | UQ actor/operation/key. IX expiry. Null status is only an in-transaction claim. A successful commit sets status and any applicable result reference. Never commit an incomplete claim. Reject changed input. Durable posting keys survive API-key expiry. |

## Scoped foreign keys and ownership

Use required scope columns in every finance row marked `scope`. The parent PK does not replace a scoped FK. Use these referenced unique tuples:

| Child columns | Referenced unique tuple |
|---|---|
| `account_id, currency` on a scoped row | `FINANCE_ACCOUNT(id, currency)` |
| `session_id, user_id` on AUTH_TOKEN | `AUTH_SESSION(id, user_id)` |
| `active_policy_id, id` on STUDIO_SETTINGS | `POLICY_REVISION(id, studio_id)` |
| `purchase_id, currency` on PURCHASE_ITEM | `PURCHASE(id, currency)` |
| `purchase_id, account_id, currency` on INSTALLMENT and FINANCE_EVENT | `PURCHASE(id, account_id, currency)` |
| `replaces_id, purchase_id, account_id, currency` on INSTALLMENT | `INSTALLMENT(id, purchase_id, account_id, currency)` |
| `corrects_id, account_id, currency` on PAYMENT, `source_payment_id, account_id, currency` on CREDIT_LOT, and `payment_id, account_id, currency` on REFUND | `PAYMENT(id, account_id, currency)` |
| `verification_event_id, account_id, currency` on PAYMENT and `reverses_event_id, account_id, currency` on FINANCE_EVENT | `FINANCE_EVENT(id, account_id, currency)` |
| `lot_id, account_id, currency` and `refund_id, account_id, currency` on FINANCE_EVENT | `CREDIT_LOT(id, account_id, currency)` and `REFUND(id, account_id, currency)`, respectively |
| `installment_id, purchase_id, account_id, currency` on FINANCE_EVENT | `INSTALLMENT(id, purchase_id, account_id, currency)` in addition to the scoped purchase FK |
| `lot_id, payment_id, account_id, currency` on REFUND | `CREDIT_LOT(id, source_payment_id, account_id, currency)` |
| `membership_id, client_id` on BOOKING_PARTICIPANT | `MEMBERSHIP(id, client_id)` |
| `notification_id, recipient_id` on OUTBOX_EVENT | `NOTIFICATION(id, recipient_id)` |

An optional reference can skip its composite FK only when that reference is legitimately absent. Pair the activation evidence event, amount, and currency. Require all three for verified-funding activation. An Admin exception requires a reason and does not use that evidence branch. Require `purchase_id` whenever an installment target is supplied, and require `session_id` for refresh and socket tokens. Check that decision actor and timestamp, lease token and expiry, and encrypted delivery secret and expiry are each set or cleared together.

For relationships that span more than one FK, resolve the following joins inside the [locked command](business-rules.md#shared-command-transaction):

| Command | Ownership and source check |
|---|---|
| Request or record a purchase | The requested version belongs to the intended package. A private package's client matches the request and the purchase's finance-account client. Acceptance preserves the exact requested version. |
| Issue or activate a membership | Purchase item → purchase → finance account supplies the membership client. The funding evidence must be an allocation to that purchase, backed by a verified receipt in the same scope. Evaluate net funding under the account lock. |
| Post a finance event | Match receipt, lot, refund, and target scope. For reversals, match the original lot, purchase, and installment as applicable. A verification pointer refers to the origin posting for the receipt's lot. |
| Decide a booking change or record attendance | Check the participant is still on the expected original slot before approving a change. For attendance, the served reservation belongs to the participant's served slot. A revision can supersede only another revision of the same attendance parent. |
| Post an entitlement entry | Resolve the source membership through membership event, refund review, or verification → revision → attendance → participant. It must match the entry membership. The review must apply to that client's purchase. A reversal must offset an entry of the same membership. |
| Read, list, or export | Apply the [canonical resource scope](permission-matrix.md#resource-scope) in the query. A valid FK or supplied ID does not authorize access. |

## Private database grants

Commission records, distributions, and commission audit use a restricted schema owned by a non-runtime role. Review migration-time and default grants. PUBLIC and ordinary API, reporting, and worker roles cannot read the schema or inherit or assume the private role. The private API connection is available only to the authorized commission service. See [commission isolation](permission-matrix.md#commission-isolation).

See [business rules](business-rules.md) for cross-row transactions and [permission matrix](permission-matrix.md) for role restrictions. References: [Prisma schema reference](https://www.prisma.io/docs/orm/v7/reference/prisma-schema-reference), [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
