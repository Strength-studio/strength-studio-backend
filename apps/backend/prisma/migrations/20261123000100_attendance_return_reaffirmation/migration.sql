BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'ATTENDANCE_RETURNED';
ALTER TYPE public.audit_action ADD VALUE 'ATTENDANCE_REAFFIRMED';
ALTER TYPE public.audit_target ADD VALUE 'ATTENDANCE_REVIEW_DECISION';
CREATE TYPE public.attendance_review_outcome AS ENUM ('RETURNED');

CREATE TABLE public.attendance_review_decision (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id uuid NOT NULL UNIQUE REFERENCES public.attendance_revision(id) ON DELETE RESTRICT,
    admin_id uuid NOT NULL REFERENCES public.app_user(id) ON DELETE RESTRICT,
    decision public.attendance_review_outcome NOT NULL,
    reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000 AND reason !~ '^[[:space:]]*$'),
    decided_at timestamptz(6) NOT NULL
);
CREATE INDEX attendance_review_decision_admin_id_idx ON public.attendance_review_decision(admin_id);

REVOKE ALL ON public.attendance_review_decision FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON public.attendance_review_decision TO studio_api;

COMMIT;
