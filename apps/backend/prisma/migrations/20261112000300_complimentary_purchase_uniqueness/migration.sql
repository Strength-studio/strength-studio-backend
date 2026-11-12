BEGIN;

ALTER TABLE public.purchase DROP CONSTRAINT purchase_client_id_package_version_id_key;

CREATE UNIQUE INDEX purchase_complimentary_client_version_key
    ON public.purchase (client_id, package_version_id)
    WHERE type = 'COMPLIMENTARY';

CREATE INDEX purchase_client_id_idx ON public.purchase (client_id);

COMMIT;
