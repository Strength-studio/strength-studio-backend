BEGIN;

CREATE TYPE public.purchase_type AS ENUM ('COMPLIMENTARY');

CREATE TABLE public.purchase (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    client_id uuid NOT NULL REFERENCES public.client_profile (user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    package_version_id uuid NOT NULL REFERENCES public.package_version (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    type public.purchase_type NOT NULL,
    accepted_by uuid NOT NULL REFERENCES public.app_user (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    accepted_at timestamptz(6) NOT NULL,
    terms jsonb NOT NULL,
    CONSTRAINT purchase_client_id_package_version_id_key UNIQUE (client_id, package_version_id),
    CONSTRAINT purchase_terms_object_check CHECK (jsonb_typeof(terms) = 'object')
);

CREATE INDEX purchase_package_version_id_idx ON public.purchase (package_version_id);
CREATE INDEX purchase_accepted_by_idx ON public.purchase (accepted_by);

-- Keep backfilled and newly accepted snapshots in the same format.
CREATE FUNCTION public.purchase_terms_for_version(version_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $body$
    SELECT jsonb_build_object(
        'code', p.code,
        'version', pv.version,
        'name', pv.name,
        'description', pv.description,
        'price', pv.price::numeric(19,2)::text,
        'currency', pv.currency,
        'kind', pv.kind,
        'validityDays', pv.validity_days,
        'sessionAllowance', pv.session_allowance,
        'sessionTypes', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', st.id, 'code', st.code, 'name', st.name, 'mode', st.mode
            ) ORDER BY st.id), '[]'::jsonb)
            FROM public.package_version_session_type AS eligibility
            JOIN public.session_type AS st ON st.id = eligibility.session_type_id
            WHERE eligibility.package_version_id = pv.id
        )
    )
    FROM public.package_version AS pv
    JOIN public.package AS p ON p.id = pv.package_id
    WHERE pv.id = version_id;
$body$;

-- These DDL locks keep legacy writes from interleaving with the backfill.
ALTER TABLE public.complimentary_acceptance ADD COLUMN purchase_id uuid;
ALTER TABLE public.membership ADD COLUMN purchase_id uuid;

INSERT INTO public.purchase (created_at, client_id, package_version_id, type, accepted_by, accepted_at, terms)
SELECT accepted_at, client_id, package_version_id, 'COMPLIMENTARY', accepted_by, accepted_at,
       public.purchase_terms_for_version(package_version_id)
FROM public.complimentary_acceptance;

UPDATE public.complimentary_acceptance AS a
SET purchase_id = p.id
FROM public.purchase AS p
WHERE p.client_id = a.client_id AND p.package_version_id = a.package_version_id;

UPDATE public.membership AS m
SET purchase_id = a.purchase_id
FROM public.complimentary_acceptance AS a
WHERE a.id = m.acceptance_id;

ALTER TABLE public.complimentary_acceptance
    ALTER COLUMN purchase_id SET NOT NULL,
    ADD CONSTRAINT complimentary_acceptance_purchase_id_key UNIQUE (purchase_id),
    ADD CONSTRAINT complimentary_acceptance_purchase_id_fkey FOREIGN KEY (purchase_id)
        REFERENCES public.purchase (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    DROP COLUMN client_id,
    DROP COLUMN package_version_id,
    DROP COLUMN accepted_by,
    DROP COLUMN accepted_at;

ALTER TABLE public.membership
    ALTER COLUMN purchase_id SET NOT NULL,
    ADD CONSTRAINT membership_purchase_id_key UNIQUE (purchase_id),
    ADD CONSTRAINT membership_purchase_id_fkey FOREIGN KEY (purchase_id)
        REFERENCES public.purchase (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    DROP COLUMN acceptance_id;

REVOKE ALL ON TABLE public.purchase FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON TABLE public.purchase TO studio_api;
REVOKE ALL ON FUNCTION public.purchase_terms_for_version(uuid) FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT EXECUTE ON FUNCTION public.purchase_terms_for_version(uuid) TO studio_api;

COMMIT;
