BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'PAYMENT_ALLOCATED';
ALTER TYPE public.audit_target ADD VALUE 'PAYMENT_ALLOCATION';

CREATE TABLE public.payment_allocation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id uuid NOT NULL REFERENCES public.payment (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    purchase_id uuid NOT NULL REFERENCES public.purchase (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    amount numeric(19,4) NOT NULL,
    currency varchar(3) NOT NULL,
    allocated_by uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT payment_allocation_amount_check CHECK (amount > 0 AND amount < 1000000000000000 AND amount = trunc(amount, 2)),
    CONSTRAINT payment_allocation_currency_check CHECK (currency = 'SAR')
);

CREATE INDEX payment_allocation_payment_id_idx ON public.payment_allocation (payment_id);
CREATE INDEX payment_allocation_purchase_id_idx ON public.payment_allocation (purchase_id);
CREATE INDEX payment_allocation_allocated_by_idx ON public.payment_allocation (allocated_by);

CREATE FUNCTION public.payment_guard_allocation() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog AS $body$
DECLARE
    receipt record;
    purchase_client_id uuid;
    allocated_amount numeric;
BEGIN
    -- A fixed snapshot could hide allocations committed while waiting for this row lock.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'Payment allocation requires READ COMMITTED visibility' USING ERRCODE = 'feature_not_supported';
    END IF;

    SELECT client_id, status, amount, currency INTO receipt
    FROM public.payment WHERE id = NEW.payment_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'SS001';
    END IF;
    IF receipt.status <> 'VERIFIED' THEN
        RAISE EXCEPTION 'Payment is not verified' USING ERRCODE = 'SS003';
    END IF;

    SELECT client_id INTO purchase_client_id FROM public.purchase WHERE id = NEW.purchase_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase not found' USING ERRCODE = 'SS002';
    END IF;
    IF purchase_client_id <> receipt.client_id THEN
        RAISE EXCEPTION 'Payment and purchase belong to different Clients' USING ERRCODE = 'SS004';
    END IF;

    -- Run the sum as a separate statement after acquiring the lock so it sees the previous writer's commit.
    SELECT COALESCE(SUM(amount), 0) INTO allocated_amount
    FROM public.payment_allocation WHERE payment_id = NEW.payment_id;
    IF NEW.amount > receipt.amount - allocated_amount THEN
        RAISE EXCEPTION 'Allocation exceeds the remaining payment amount' USING ERRCODE = 'SS005';
    END IF;

    NEW.currency := receipt.currency;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
END;
$body$;

CREATE TRIGGER payment_guard_allocation
    BEFORE INSERT ON public.payment_allocation
    FOR EACH ROW EXECUTE FUNCTION public.payment_guard_allocation();

REVOKE ALL ON TABLE public.payment_allocation FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT ON TABLE public.payment_allocation TO studio_api;
GRANT INSERT (payment_id, purchase_id, amount, allocated_by) ON public.payment_allocation TO studio_api;
REVOKE ALL ON FUNCTION public.payment_guard_allocation() FROM PUBLIC;

COMMIT;
