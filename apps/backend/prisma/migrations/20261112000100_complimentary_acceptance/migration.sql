BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'PURCHASE_ACCEPTED_RECORDED';
ALTER TYPE public.audit_target ADD VALUE 'COMPLIMENTARY_ACCEPTANCE';
CREATE TYPE public.agreement_method AS ENUM ('SIGNED_AGREEMENT', 'VERBAL_AGREEMENT');
CREATE TYPE public.membership_status AS ENUM ('PENDING_ACTIVATION');

CREATE TABLE public.complimentary_acceptance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES public.client_profile (user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    package_version_id uuid NOT NULL REFERENCES public.package_version (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    accepted_by uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    accepted_at timestamptz(6) NOT NULL,
    agreement_method public.agreement_method NOT NULL,
    agreement_evidence varchar(2000) NOT NULL,
    purpose varchar(240) NOT NULL,
    CONSTRAINT complimentary_acceptance_client_id_package_version_id_key UNIQUE (client_id, package_version_id),
    CONSTRAINT complimentary_acceptance_evidence_check CHECK (agreement_evidence ~ '[^[:space:]]'),
    CONSTRAINT complimentary_acceptance_purpose_check CHECK (purpose ~ '[^[:space:]]')
);

CREATE INDEX complimentary_acceptance_package_version_id_idx ON public.complimentary_acceptance (package_version_id);
CREATE INDEX complimentary_acceptance_accepted_by_idx ON public.complimentary_acceptance (accepted_by);

CREATE TABLE public.membership (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status public.membership_status NOT NULL DEFAULT 'PENDING_ACTIVATION',
    acceptance_id uuid NOT NULL UNIQUE REFERENCES public.complimentary_acceptance (id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

REVOKE ALL ON TABLE public.complimentary_acceptance, public.membership
    FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON TABLE public.complimentary_acceptance, public.membership TO studio_api;

COMMIT;
