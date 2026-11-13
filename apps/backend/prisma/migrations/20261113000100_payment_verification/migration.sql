BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'PAYMENT_VERIFIED';
ALTER TYPE public.payment_status ADD VALUE 'VERIFIED';

-- Compare status as text while the new enum value is still uncommitted.
ALTER TABLE public.payment
    ADD COLUMN verified_by uuid REFERENCES public.app_user (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD COLUMN verified_at timestamptz(6),
    ADD CONSTRAINT payment_verification_check CHECK (
        (status = 'UNVERIFIED' AND verified_by IS NULL AND verified_at IS NULL)
        OR (status::text = 'VERIFIED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND isfinite(verified_at))
    );

CREATE FUNCTION public.payment_guard_verification() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'UNVERIFIED' OR NEW.status <> 'VERIFIED' THEN
        RAISE EXCEPTION 'Payment updates must transition from UNVERIFIED to VERIFIED' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER payment_guard_verification
    BEFORE UPDATE ON public.payment
    FOR EACH ROW EXECUTE FUNCTION public.payment_guard_verification();

REVOKE INSERT ON public.payment FROM studio_api;
-- Prisma includes the default status in its INSERT. The check requires verifier metadata for VERIFIED.
GRANT INSERT (id, intake_id, client_id, recorded_by, amount, currency, method, status, received_at, created_at, reference, evidence)
    ON public.payment TO studio_api;
GRANT UPDATE (status, verified_by, verified_at) ON public.payment TO studio_api;

COMMIT;
