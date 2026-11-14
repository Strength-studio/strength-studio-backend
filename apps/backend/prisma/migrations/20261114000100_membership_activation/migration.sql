BEGIN;
ALTER TYPE public.membership_status ADD VALUE 'ACTIVE';
ALTER TYPE public.audit_action ADD VALUE 'MEMBERSHIP_ACTIVATED';
ALTER TYPE public.audit_target ADD VALUE 'MEMBERSHIP';

-- The text comparison allows the new enum value and its constraint to deploy atomically.
ALTER TABLE public.membership
    ADD COLUMN activated_at timestamptz(6),
    ADD COLUMN valid_from date,
    ADD COLUMN valid_through date,
    ADD COLUMN initial_session_allowance integer,
    ADD CONSTRAINT membership_activation_shape_check CHECK (
        (status = 'PENDING_ACTIVATION' AND activated_at IS NULL AND valid_from IS NULL
            AND valid_through IS NULL AND initial_session_allowance IS NULL)
        OR (status::text = 'ACTIVE' AND activated_at IS NOT NULL AND valid_from IS NOT NULL
            AND valid_through IS NOT NULL AND valid_through >= valid_from
            AND valid_from = (activated_at AT TIME ZONE 'Asia/Riyadh')::date
            AND (initial_session_allowance IS NULL OR initial_session_allowance > 0))
    );

GRANT UPDATE (status, activated_at, valid_from, valid_through, initial_session_allowance)
    ON public.membership TO studio_api;

-- The allocation FK already takes KEY SHARE on this row before an insert can commit.
-- FOR UPDATE conflicts with that lock, without granting UPDATE on immutable purchases.
CREATE FUNCTION public.lock_purchase_for_activation(purchase_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $body$
    SELECT EXISTS (SELECT 1 FROM public.purchase WHERE id = purchase_id FOR UPDATE);
$body$;
REVOKE ALL ON FUNCTION public.lock_purchase_for_activation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_purchase_for_activation(uuid) TO studio_api;
COMMIT;
