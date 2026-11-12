BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'PAYMENT_RECORDED';
ALTER TYPE public.audit_target ADD VALUE 'PAYMENT';
CREATE TYPE public.payment_method AS ENUM ('CASH', 'BANK_TRANSFER', 'MADA', 'STC_PAY');
CREATE TYPE public.payment_status AS ENUM ('UNVERIFIED');

CREATE TABLE public.payment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id uuid NOT NULL UNIQUE,
    client_id uuid NOT NULL REFERENCES public.client_profile (user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    recorded_by uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    amount numeric(19,4) NOT NULL,
    currency varchar(3) NOT NULL,
    method public.payment_method NOT NULL,
    status public.payment_status NOT NULL DEFAULT 'UNVERIFIED',
    received_at timestamptz(6) NOT NULL,
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference varchar(200),
    evidence varchar(2000),
    CONSTRAINT payment_amount_check CHECK (amount > 0 AND amount < 1000000000000000 AND amount = trunc(amount, 2)),
    CONSTRAINT payment_currency_check CHECK (currency = 'SAR'),
    CONSTRAINT payment_received_at_check CHECK (isfinite(received_at) AND received_at <= created_at),
    CONSTRAINT payment_reference_check CHECK (reference IS NULL OR reference ~ '[^[:space:]]'),
    CONSTRAINT payment_evidence_check CHECK (evidence IS NULL OR evidence ~ '[^[:space:]]')
);

CREATE INDEX payment_client_id_idx ON public.payment (client_id);
CREATE INDEX payment_recorded_by_idx ON public.payment (recorded_by);

REVOKE ALL ON TABLE public.payment FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON TABLE public.payment TO studio_api;

COMMIT;
