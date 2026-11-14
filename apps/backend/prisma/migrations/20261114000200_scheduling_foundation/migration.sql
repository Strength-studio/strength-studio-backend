BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
ALTER TYPE public.audit_action ADD VALUE 'SCHEDULING_SETTINGS_CHANGED';
ALTER TYPE public.audit_action ADD VALUE 'SCHEDULED_SESSION_CREATED';
ALTER TYPE public.audit_action ADD VALUE 'SCHEDULED_SESSION_EDITED';
ALTER TYPE public.audit_action ADD VALUE 'SCHEDULED_SESSION_CANCELLED';
ALTER TYPE public.audit_target ADD VALUE 'SCHEDULED_SESSION';

CREATE TABLE public.scheduling_settings (
    session_type_id uuid PRIMARY KEY REFERENCES public.session_type(id) ON DELETE RESTRICT,
    duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
    buffer_minutes integer NOT NULL CHECK (buffer_minutes >= 0),
    group_capacity integer CHECK (group_capacity > 0)
);

CREATE TABLE public.scheduled_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_type_id uuid NOT NULL REFERENCES public.session_type(id) ON DELETE RESTRICT,
    coach_id uuid NOT NULL REFERENCES public.coach_profile(user_id) ON DELETE RESTRICT,
    starts_at timestamptz(6) NOT NULL,
    ends_at timestamptz(6) NOT NULL,
    buffer_minutes integer NOT NULL CHECK (buffer_minutes >= 0),
    capacity integer NOT NULL CHECK (capacity > 0),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    cancelled_at timestamptz(6),
    cancellation_reason varchar(500),
    CONSTRAINT scheduled_session_duration_check CHECK (starts_at < ends_at AND isfinite(starts_at) AND isfinite(ends_at)),
    CONSTRAINT scheduled_session_cancellation_check CHECK (
        (cancelled_at IS NULL AND cancellation_reason IS NULL)
        OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
    ),
    -- Convert to UTC before interval arithmetic to keep the index expression immutable.
    CONSTRAINT scheduled_session_coach_overlap EXCLUDE USING gist (
        coach_id WITH =,
        tsrange(starts_at AT TIME ZONE 'UTC',
            (ends_at AT TIME ZONE 'UTC') + make_interval(mins => buffer_minutes), '[)') WITH &&
    ) WHERE (cancelled_at IS NULL)
);

CREATE INDEX scheduled_session_starts_at_id_idx ON public.scheduled_session(starts_at, id);
CREATE INDEX scheduled_session_coach_id_starts_at_idx ON public.scheduled_session(coach_id, starts_at);
CREATE INDEX scheduled_session_session_type_id_idx ON public.scheduled_session(session_type_id);

REVOKE ALL ON public.scheduling_settings, public.scheduled_session FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON public.scheduling_settings, public.scheduled_session TO studio_api;
GRANT UPDATE (duration_minutes, buffer_minutes, group_capacity) ON public.scheduling_settings TO studio_api;
GRANT UPDATE (coach_id, starts_at, ends_at, revision, updated_at, cancelled_at, cancellation_reason)
    ON public.scheduled_session TO studio_api;

COMMIT;
