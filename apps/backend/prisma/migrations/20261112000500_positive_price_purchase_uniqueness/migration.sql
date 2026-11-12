-- PostgreSQL requires the new enum value to be committed before it can be used here.
CREATE UNIQUE INDEX purchase_positive_price_client_version_key
    ON public.purchase (client_id, package_version_id)
    WHERE type = 'POSITIVE_PRICE';
