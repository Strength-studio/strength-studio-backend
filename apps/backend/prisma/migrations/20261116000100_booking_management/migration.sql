BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'BOOKING_CREATED';
ALTER TYPE public.audit_action ADD VALUE 'BOOKING_APPROVED';
ALTER TYPE public.audit_action ADD VALUE 'BOOKING_REJECTED';
ALTER TYPE public.audit_action ADD VALUE 'BOOKING_CANCELLED';
ALTER TYPE public.audit_target ADD VALUE 'BOOKING';
CREATE TYPE public.booking_status AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');

CREATE TABLE public.booking (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES public.client_profile(user_id) ON DELETE RESTRICT,
    scheduled_session_id uuid NOT NULL REFERENCES public.scheduled_session(id) ON DELETE RESTRICT,
    membership_id uuid NOT NULL REFERENCES public.membership(id) ON DELETE RESTRICT,
    status public.booking_status NOT NULL DEFAULT 'PENDING',
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX booking_client_id_idx ON public.booking(client_id);
CREATE INDEX booking_scheduled_session_id_created_at_id_idx ON public.booking(scheduled_session_id, created_at, id);
CREATE INDEX booking_scheduled_session_id_status_idx ON public.booking(scheduled_session_id, status);
CREATE INDEX booking_membership_id_status_idx ON public.booking(membership_id, status);
CREATE UNIQUE INDEX booking_active_client_session_key ON public.booking(client_id, scheduled_session_id)
    WHERE status IN ('PENDING', 'CONFIRMED');

REVOKE ALL ON public.booking FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT ON public.booking TO studio_api;
GRANT INSERT (client_id, scheduled_session_id, membership_id, created_at, updated_at) ON public.booking TO studio_api;
GRANT UPDATE (status, updated_at) ON public.booking TO studio_api;

COMMIT;
