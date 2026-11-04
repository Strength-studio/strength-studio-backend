# Domain model and revised ERD

Status: proposed Milestone 0 schema. The two panels form one model. The [data dictionary](data-dictionary.md) defines all foreign keys, including actor, policy, scoped, and self-referencing edges omitted from the panels for readability. One studio is assumed. Branches are out of scope.

## Commercial and entitlement

```mermaid
erDiagram
    USER ||--o| CLIENT_PROFILE : has
    USER ||--o| COACH_PROFILE : has
    USER ||--o{ STAFF_GRANT : receives
    USER ||--o{ AUTH_SESSION : owns
    USER ||--o{ AUTH_TOKEN : receives
    AUTH_SESSION o|--o{ AUTH_TOKEN : scopes
    STUDIO_SETTINGS ||--o{ POLICY_REVISION : versions
    CLIENT_PROFILE o|--o{ PACKAGE : owns_private_offers
    PACKAGE ||--o{ PACKAGE_VERSION : versions
    PACKAGE_VERSION ||--o{ PACKAGE_VERSION_SESSION_TYPE : permits
    SESSION_TYPE ||--o{ PACKAGE_VERSION_SESSION_TYPE : maps
    CLIENT_PROFILE ||--o{ PURCHASE_REQUEST : submits
    PACKAGE_VERSION ||--o{ PURCHASE_REQUEST : requested_as
    PURCHASE_REQUEST o|--o| PURCHASE : becomes
    CLIENT_PROFILE ||--o{ FINANCE_ACCOUNT : owns_by_currency
    FINANCE_ACCOUNT ||--o{ PURCHASE : scopes
    PURCHASE ||--|{ PURCHASE_ITEM : contains
    PACKAGE_VERSION ||--o{ PURCHASE_ITEM : supplies_terms
    PURCHASE ||--o{ INSTALLMENT : schedules
    PURCHASE_ITEM ||--o| MEMBERSHIP : grants
    CLIENT_PROFILE ||--o{ MEMBERSHIP : holds
    FINANCE_ACCOUNT ||--o{ PAYMENT : records
    FINANCE_ACCOUNT ||--o{ CREDIT_LOT : owns
    FINANCE_ACCOUNT ||--o{ FINANCE_EVENT : posts
    FINANCE_ACCOUNT ||--o{ REFUND : scopes
    PAYMENT o|--o| CREDIT_LOT : originates
    FINANCE_EVENT o|--o| PAYMENT : verifies
    CREDIT_LOT o|--o{ FINANCE_EVENT : funds
    PURCHASE o|--o{ FINANCE_EVENT : targets
    INSTALLMENT o|--o{ FINANCE_EVENT : allocates
    PAYMENT ||--o{ REFUND : caps
    CREDIT_LOT ||--o{ REFUND : funds
    REFUND o|--o{ FINANCE_EVENT : links_postings
    MEMBERSHIP ||--o{ MEMBERSHIP_EVENT : changes
    FINANCE_EVENT o|--o{ MEMBERSHIP_EVENT : evidences_activation
    MEMBERSHIP ||--o{ ENTITLEMENT_ENTRY : reconciles
    MEMBERSHIP ||--o{ ENTITLEMENT_REVIEW : reviews
    REFUND ||--o{ ENTITLEMENT_REVIEW : prompts
    ENTITLEMENT_REVIEW o|--o{ MEMBERSHIP_EVENT : authorizes
    ENTITLEMENT_REVIEW o|--o| ENTITLEMENT_ENTRY : sources
    MEMBERSHIP_EVENT o|--o| ENTITLEMENT_ENTRY : sources
```

## Service delivery, privacy, and operations

```mermaid
erDiagram
    COACH_PROFILE ||--o{ COACH_AVAILABILITY : declares
    COACH_PROFILE ||--o{ COACH_RESERVATION : holds
    SESSION_TYPE ||--o{ SESSION_SLOT : classifies
    SESSION_SLOT ||--o{ COACH_RESERVATION : records_assignments
    SESSION_SLOT o|--o{ BOOKING_PARTICIPANT : hosts
    CLIENT_PROFILE ||--o{ BOOKING_PARTICIPANT : reserves
    MEMBERSHIP ||--o{ BOOKING_PARTICIPANT : qualifies
    BOOKING_PARTICIPANT ||--o{ BOOKING_CHANGE : tracks
    SESSION_SLOT ||--o{ BOOKING_CHANGE : original_slot
    SESSION_SLOT o|--o{ BOOKING_CHANGE : target_slot
    BOOKING_PARTICIPANT ||--o| ATTENDANCE : has
    COACH_RESERVATION ||--o{ ATTENDANCE : attributes_service
    ATTENDANCE ||--|{ ATTENDANCE_REVISION : preserves
    ATTENDANCE_REVISION ||--o| ATTENDANCE_VERIFICATION : receives_decision
    ATTENDANCE_VERIFICATION o|--o| ENTITLEMENT_ENTRY : sources
    USER ||--o{ NOTIFICATION : receives
    USER ||--o{ OUTBOX_EVENT : receives_delivery
    NOTIFICATION o|--o{ OUTBOX_EVENT : may_trigger
    OUTBOX_EVENT ||--o{ DELIVERY_ATTEMPT : records
    USER o|--o{ AUDIT_LOG : acts_in
    USER ||--o{ IDEMPOTENCY_KEY : scopes
    COACH_PROFILE ||--o{ COMMISSION_RECORD : relates_to
    COMMISSION_RECORD ||--o{ COMMISSION_DISTRIBUTION : settles_manually
    COMMISSION_RECORD o|--o{ COMMISSION_AUDIT_LOG : audited
    COMMISSION_DISTRIBUTION o|--o{ COMMISSION_AUDIT_LOG : audited
```

## Relationship corrections

- **Payment allocation is a relationship, not a second ledger.** Read PAYMENT → CREDIT_LOT → allocation FINANCE_EVENT → PURCHASE and optional INSTALLMENT. The event is the allocation row. Many lots can fund one installment and one lot can fund many installments. Reversal events reference prior allocation events. REFUND references the original payment and lot, and its linked events record any funding reversals and cash return. A refund can have zero or more entitlement reviews, each scoped to one membership.
- **Activation evidence belongs to the purchase.** MEMBERSHIP comes from one PURCHASE_ITEM. An activation MEMBERSHIP_EVENT cites a relevant allocation event backed by a verified payment and the policy used, or records a reasoned Admin exception. The transaction validates the full funding threshold across relevant allocations. One cited event is an evidence anchor, not the total.
- **Entitlement has multiple authorized sources.** An initial grant or administrative adjustment comes from a membership event, a refund effect from an entitlement review, and a verified usage adjustment from an accepted attendance verification. Each entry has exactly one source. ATTENDANCE_VERIFICATION is not a child of MEMBERSHIP_EVENT. They meet through the participant and entitlement entry.
- **One participant is one seat.** BOOKING_PARTICIPANT is the public booking ID. A group slot has many participant bookings, one per client per active slot. Slotless alternative requests do not reserve a seat. Group attendance is per participant.
- **Current projections and history differ.** Booking and membership hold current state. Booking changes, membership events, served coach assignments, attendance revisions, verification decisions, finance events, and entitlement entries preserve history. Account and unit balances are computed, never overwritten. The [scoped FK and ownership map](data-dictionary.md#scoped-foreign-keys-and-ownership) binds these records to the same client, purchase, or service assignment where required.
- **Versioned offers preserve agreed terms.** Public or client-only packages have immutable published versions and session eligibility. The purchase item snapshots agreed terms. Renegotiation creates a new version or a new explicit offer. It never silently substitutes price or validity on an existing request or purchase.
- **Private commission audit is a distinct access surface.** Commission records, distributions, and their audit use a restricted schema. Staff profiles do not need a separate table. Waitlist can use the participant model if enabled. A general ledger, branch entity, and push device registration are outside the initial build.

See [business rules](business-rules.md) for states and locks, and [permissions](permission-matrix.md) for access boundaries.
