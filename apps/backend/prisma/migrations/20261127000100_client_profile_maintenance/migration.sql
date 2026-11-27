-- Existing Client maintenance only. No identity creation or credential privileges.
ALTER TYPE public.audit_action ADD VALUE 'CLIENT_PROFILE_UPDATED';
GRANT UPDATE (display_name) ON public.client_profile TO studio_api;
