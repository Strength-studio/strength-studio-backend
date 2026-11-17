BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'ATTENDANCE_SUBMITTED';
ALTER TYPE public.audit_target ADD VALUE 'ATTENDANCE_REVISION';
CREATE TYPE public.attendance_outcome AS ENUM ('ATTENDED');

ALTER TABLE public.booking ADD CONSTRAINT booking_id_scheduled_session_id_key UNIQUE (id, scheduled_session_id);

CREATE TABLE public.session_attendance (
    scheduled_session_id uuid PRIMARY KEY REFERENCES public.scheduled_session(id) ON DELETE RESTRICT,
    served_coach_id uuid NOT NULL REFERENCES public.coach_profile(user_id) ON DELETE RESTRICT,
    served_starts_at timestamptz(6) NOT NULL,
    served_session_type_id uuid NOT NULL REFERENCES public.session_type(id) ON DELETE RESTRICT
);

CREATE TABLE public.attendance_participant (
    booking_id uuid PRIMARY KEY,
    scheduled_session_id uuid NOT NULL REFERENCES public.session_attendance(scheduled_session_id) ON DELETE RESTRICT,
    CONSTRAINT attendance_participant_booking_fkey FOREIGN KEY (booking_id, scheduled_session_id)
        REFERENCES public.booking(id, scheduled_session_id) ON DELETE RESTRICT
);

CREATE INDEX attendance_participant_scheduled_session_id_idx ON public.attendance_participant(scheduled_session_id);

CREATE TABLE public.attendance_revision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id uuid NOT NULL REFERENCES public.attendance_participant(booking_id) ON DELETE RESTRICT,
    revision integer NOT NULL CHECK (revision >= 1),
    outcome public.attendance_outcome NOT NULL,
    submitted_by_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE RESTRICT,
    submitted_at timestamptz(6) NOT NULL,
    CONSTRAINT attendance_revision_booking_id_revision_key UNIQUE (booking_id, revision)
);

REVOKE ALL ON public.session_attendance, public.attendance_participant, public.attendance_revision
    FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON public.session_attendance, public.attendance_participant, public.attendance_revision TO studio_api;

COMMIT;
