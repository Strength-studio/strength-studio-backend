-- Public catalog for PostgreSQL 17. Requires the Foundation migration and roles.
BEGIN;

ALTER TYPE public.audit_action ADD VALUE 'CATALOG_CREATED';
ALTER TYPE public.audit_action ADD VALUE 'CATALOG_VERSION_CREATED';
ALTER TYPE public.audit_action ADD VALUE 'CATALOG_DRAFT_CHANGED';
ALTER TYPE public.audit_action ADD VALUE 'CATALOG_PUBLISHED';
ALTER TYPE public.audit_action ADD VALUE 'CATALOG_ARCHIVED';
ALTER TYPE public.audit_action ADD VALUE 'CATALOG_REFERENCE_CHANGED';
ALTER TYPE public.audit_target ADD VALUE 'PACKAGE';
ALTER TYPE public.audit_target ADD VALUE 'SESSION_TYPE';

CREATE TYPE public.package_kind AS ENUM ('TIME', 'SESSION');
CREATE TYPE public.session_type_mode AS ENUM ('INDIVIDUAL', 'GROUP');

CREATE TABLE public.package (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    code varchar(40) NOT NULL,
    archived_at timestamptz(6),
    CONSTRAINT package_pkey PRIMARY KEY (id),
    CONSTRAINT package_code_key UNIQUE (code),
    CONSTRAINT package_code_check CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$')
);

CREATE TABLE public.package_version (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    package_id uuid NOT NULL,
    version integer NOT NULL,
    based_on_version_id uuid,
    name varchar(120) NOT NULL,
    description varchar(2000) NOT NULL,
    price numeric(19,4) NOT NULL,
    currency varchar(3) NOT NULL DEFAULT 'SAR',
    kind public.package_kind NOT NULL,
    validity_days integer NOT NULL,
    session_allowance integer,
    draft_revision integer NOT NULL DEFAULT 1,
    published_at timestamptz(6),
    superseded_at timestamptz(6),
    CONSTRAINT package_version_pkey PRIMARY KEY (id),
    CONSTRAINT package_version_package_id_version_key UNIQUE (package_id, version),
    CONSTRAINT package_version_package_id_id_key UNIQUE (package_id, id),
    CONSTRAINT package_version_package_id_fkey FOREIGN KEY (package_id)
        REFERENCES public.package (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT package_version_base_fkey FOREIGN KEY (package_id, based_on_version_id)
        REFERENCES public.package_version (package_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT package_version_identity_check CHECK (
        version > 0 AND draft_revision > 0
        AND ((version = 1 AND based_on_version_id IS NULL)
          OR (version > 1 AND based_on_version_id IS NOT NULL AND based_on_version_id <> id))
    ),
    CONSTRAINT package_version_terms_check CHECK (
        btrim(name) <> '' AND currency = 'SAR' AND validity_days > 0
        AND price >= 0 AND price < 1000000000000000 AND price = trunc(price, 2)
        AND ((kind = 'TIME' AND session_allowance IS NULL)
          OR (kind = 'SESSION' AND session_allowance IS NOT NULL AND session_allowance > 0))
    ),
    CONSTRAINT package_version_lifecycle_check CHECK (
        superseded_at IS NULL OR (published_at IS NOT NULL AND superseded_at >= published_at)
    )
);

CREATE UNIQUE INDEX package_version_current_issued_key
    ON public.package_version (package_id)
    WHERE published_at IS NOT NULL AND superseded_at IS NULL;
CREATE INDEX package_version_base_idx ON public.package_version (package_id, based_on_version_id);

CREATE TABLE public.session_type (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    code varchar(40) NOT NULL,
    name varchar(120) NOT NULL,
    mode public.session_type_mode NOT NULL,
    archived_at timestamptz(6),
    CONSTRAINT session_type_pkey PRIMARY KEY (id),
    CONSTRAINT session_type_code_key UNIQUE (code),
    CONSTRAINT session_type_code_check CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
    CONSTRAINT session_type_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE public.package_version_session_type (
    package_version_id uuid NOT NULL,
    session_type_id uuid NOT NULL,
    CONSTRAINT package_version_session_type_pkey PRIMARY KEY (package_version_id, session_type_id),
    CONSTRAINT package_version_session_type_version_fkey FOREIGN KEY (package_version_id)
        REFERENCES public.package_version (id) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT package_version_session_type_type_fkey FOREIGN KEY (session_type_id)
        REFERENCES public.session_type (id) ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX package_version_session_type_type_idx
    ON public.package_version_session_type (session_type_id);

-- Only the archive timestamp is writable on these records after insertion.
CREATE FUNCTION public.catalog_guard_archive() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $body$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.archived_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_insert_unarchived',
                MESSAGE = 'Catalog records must start unarchived';
        END IF;
    ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_archive_terminal',
            MESSAGE = 'Catalog archival is terminal';
    END IF;
    RETURN NEW;
END;
$body$;

CREATE TRIGGER package_guard_archive
    BEFORE INSERT OR UPDATE OF archived_at ON public.package
    FOR EACH ROW EXECUTE FUNCTION public.catalog_guard_archive();
CREATE TRIGGER session_type_guard_archive
    BEFORE INSERT OR UPDATE OF archived_at ON public.session_type
    FOR EACH ROW EXECUTE FUNCTION public.catalog_guard_archive();

CREATE FUNCTION public.catalog_guard_version() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $body$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.published_at IS NOT NULL OR NEW.superseded_at IS NOT NULL OR NEW.draft_revision <> 1 THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_version_insert_draft',
                MESSAGE = 'New versions must start as drafts';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.published_at IS NOT NULL THEN
        IF (to_jsonb(NEW) - 'superseded_at') IS DISTINCT FROM (to_jsonb(OLD) - 'superseded_at')
           OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_issued_version_immutable',
                MESSAGE = 'Issued version terms cannot change';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.published_at IS NULL THEN
        IF NEW.draft_revision <> OLD.draft_revision + 1 THEN
            RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_draft_revision_step',
                MESSAGE = 'Draft updates must advance the revision';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.superseded_at IS NOT NULL
       OR (to_jsonb(NEW) - 'published_at') IS DISTINCT FROM (to_jsonb(OLD) - 'published_at') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_publish_freezes_draft',
            MESSAGE = 'Publishing must preserve the reviewed draft';
    END IF;

    -- Hold type rows through publication so type retirement serializes with issuance.
    PERFORM session_type.id
        FROM public.package_version_session_type AS eligible
        JOIN public.session_type ON session_type.id = eligible.session_type_id
        WHERE eligible.package_version_id = NEW.id
        ORDER BY session_type.id
        FOR NO KEY UPDATE OF session_type;

    IF NOT FOUND OR EXISTS (
        SELECT 1
        FROM public.package_version_session_type AS eligible
        JOIN public.session_type ON session_type.id = eligible.session_type_id
        WHERE eligible.package_version_id = NEW.id AND session_type.archived_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_publish_active_eligibility',
            MESSAGE = 'Publishing requires at least one eligible type and all linked types must be active';
    END IF;
    RETURN NEW;
END;
$body$;

CREATE TRIGGER package_version_guard
    BEFORE INSERT OR UPDATE ON public.package_version
    FOR EACH ROW EXECUTE FUNCTION public.catalog_guard_version();

CREATE FUNCTION public.catalog_guard_eligibility() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $body$
DECLARE
    target_version_id uuid;
    issued_at timestamptz;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_version_id := OLD.package_version_id;
    ELSE
        target_version_id := NEW.package_version_id;
    END IF;

    -- The same version row is locked by publication and by draft replacement.
    SELECT published_at INTO issued_at
        FROM public.package_version WHERE id = target_version_id FOR NO KEY UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23503', CONSTRAINT = 'package_version_session_type_version_fkey',
            MESSAGE = 'Eligibility requires an existing draft version';
    END IF;
    IF issued_at IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'catalog_issued_eligibility_immutable',
            MESSAGE = 'Issued version eligibility cannot change';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$body$;

CREATE TRIGGER package_version_session_type_guard
    BEFORE INSERT OR DELETE ON public.package_version_session_type
    FOR EACH ROW EXECUTE FUNCTION public.catalog_guard_eligibility();

REVOKE ALL ON TABLE public.package, public.package_version,
    public.session_type, public.package_version_session_type
    FROM PUBLIC, studio_api, studio_reporting, studio_worker;
GRANT SELECT, INSERT ON TABLE public.package, public.package_version,
    public.session_type, public.package_version_session_type TO studio_api;
GRANT UPDATE (archived_at) ON public.package, public.session_type TO studio_api;
GRANT UPDATE (name, description, price, kind, validity_days, session_allowance,
    draft_revision, published_at, superseded_at) ON public.package_version TO studio_api;
GRANT DELETE ON public.package_version_session_type TO studio_api;

REVOKE ALL ON FUNCTION public.catalog_guard_archive(), public.catalog_guard_version(),
    public.catalog_guard_eligibility() FROM PUBLIC, studio_reporting, studio_worker;
GRANT EXECUTE ON FUNCTION public.catalog_guard_archive(), public.catalog_guard_version(),
    public.catalog_guard_eligibility() TO studio_api;

-- New audit enum labels are first used by the API after this transaction commits.
COMMIT;
