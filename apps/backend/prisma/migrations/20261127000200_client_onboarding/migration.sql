-- CreateEnum
CREATE TYPE "onboarding_purpose" AS ENUM ('SETUP', 'EMAIL', 'PASSWORD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "audit_action" ADD VALUE 'CLIENT_INVITED';
ALTER TYPE "audit_action" ADD VALUE 'SETUP_LINK_REISSUED';
ALTER TYPE "audit_action" ADD VALUE 'ONBOARDING_REVOKED';
ALTER TYPE "audit_action" ADD VALUE 'SETUP_LINK_CONSUMED';
ALTER TYPE "audit_action" ADD VALUE 'EMAIL_CHALLENGE_ISSUED';
ALTER TYPE "audit_action" ADD VALUE 'EMAIL_VERIFIED';
ALTER TYPE "audit_action" ADD VALUE 'PASSWORD_SETUP_COMPLETED';
ALTER TYPE "audit_action" ADD VALUE 'ACCOUNT_ENABLED';
ALTER TYPE "audit_action" ADD VALUE 'ONBOARDING_REJECTED';

-- AlterEnum
ALTER TYPE "audit_target" ADD VALUE 'ONBOARDING_REQUEST';

-- CreateTable
CREATE TABLE "client_onboarding" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "revoked_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "client_onboarding_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "onboarding_challenge" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "purpose" "onboarding_purpose" NOT NULL,
    "revision" INTEGER NOT NULL,
    "replacement" BOOLEAN NOT NULL DEFAULT false,
    "digest" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "onboarding_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_delivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "challenge_id" UUID NOT NULL,
    "ciphertext" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_id" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "accepted_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),

    CONSTRAINT "onboarding_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_onboarding_created_by_idx" ON "client_onboarding"("created_by");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_challenge_digest_key" ON "onboarding_challenge"("digest");

-- CreateIndex
CREATE INDEX "onboarding_challenge_user_id_purpose_created_at_idx" ON "onboarding_challenge"("user_id", "purpose", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_delivery_challenge_id_key" ON "onboarding_delivery"("challenge_id");

-- CreateIndex
CREATE INDEX "onboarding_delivery_available_at_lease_until_idx" ON "onboarding_delivery"("available_at", "lease_until");

-- AddForeignKey
ALTER TABLE "client_onboarding" ADD CONSTRAINT "client_onboarding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_onboarding" ADD CONSTRAINT "client_onboarding_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "onboarding_challenge" ADD CONSTRAINT "onboarding_challenge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "client_onboarding"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "onboarding_delivery" ADD CONSTRAINT "onboarding_delivery_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "onboarding_challenge"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- One current unconsumed proof per purpose; expiry is checked using DB time by the writer.
ALTER TABLE public.client_onboarding ADD CONSTRAINT onboarding_state_check
  CHECK (revision > 0 AND NOT (revoked_at IS NOT NULL AND completed_at IS NOT NULL));
ALTER TABLE public.onboarding_challenge ADD CONSTRAINT onboarding_challenge_shape_check
  CHECK (revision > 0 AND expires_at > created_at AND digest ~ '^[0-9a-f]{64}$'
    AND NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL));
CREATE UNIQUE INDEX onboarding_current_purpose ON public.onboarding_challenge(user_id,purpose)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
ALTER TABLE public.onboarding_delivery ADD CONSTRAINT onboarding_delivery_shape_check
  CHECK (attempts >= 0 AND ((lease_id IS NULL) = (lease_until IS NULL))
    AND NOT (accepted_at IS NOT NULL AND failed_at IS NOT NULL));
GRANT SELECT, INSERT ON public.client_onboarding, public.onboarding_challenge, public.onboarding_delivery TO studio_api;
GRANT UPDATE (revision,revoked_at,completed_at) ON public.client_onboarding TO studio_api;
GRANT UPDATE (consumed_at,revoked_at) ON public.onboarding_challenge TO studio_api;
GRANT UPDATE (ciphertext,attempts,available_at,lease_id,lease_until,accepted_at,failed_at) ON public.onboarding_delivery TO studio_api;

-- No general app_user/client_profile INSERT or credential UPDATE privilege is added.
CREATE FUNCTION public.onboarding_create_client(actor uuid, email text, name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_user WHERE id=actor AND role='ADMIN'
      AND account_state='ACTIVE' AND email_verified_at IS NOT NULL)
    OR email<>lower(btrim(email)) OR length(email)>254 OR length(name) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid onboarding creation' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.app_user(normalized_email,role,account_state)
    VALUES(email,'CLIENT','INVITED') RETURNING id INTO result;
  INSERT INTO public.client_profile(user_id,display_name) VALUES(result,name);
  RETURN result;
END $$;
CREATE FUNCTION public.onboarding_record_email(target uuid, proof uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.onboarding_challenge c
    JOIN public.client_onboarding o ON o.user_id=c.user_id
    WHERE c.id=proof AND c.user_id=target AND c.purpose='EMAIL' AND c.consumed_at IS NOT NULL
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.revision=o.revision
      AND o.revoked_at IS NULL AND o.completed_at IS NULL) THEN
    RAISE EXCEPTION 'invalid onboarding proof' USING ERRCODE='23514';
  END IF;
  UPDATE public.app_user SET email_verified_at=coalesce(email_verified_at,clock_timestamp())
    WHERE id=target AND role='CLIENT' AND account_state='PENDING_VERIFICATION' AND password_hash IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid onboarding target' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION public.onboarding_complete_password(target uuid, proof uuid, hashed text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF hashed NOT LIKE '$argon2id$%' OR NOT EXISTS (SELECT 1 FROM public.onboarding_challenge c
    JOIN public.client_onboarding o ON o.user_id=c.user_id
    WHERE c.id=proof AND c.user_id=target AND c.purpose='PASSWORD' AND c.consumed_at IS NOT NULL
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.revision=o.revision
      AND o.revoked_at IS NULL AND o.completed_at IS NULL) THEN
    RAISE EXCEPTION 'invalid password authorization' USING ERRCODE='23514';
  END IF;
  UPDATE public.app_user SET password_hash=hashed,account_state='ACTIVE'
    WHERE id=target AND role='CLIENT' AND account_state='PENDING_VERIFICATION'
      AND password_hash IS NULL AND email_verified_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid onboarding target' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.onboarding_create_client(uuid,text,text),
  public.onboarding_record_email(uuid,uuid), public.onboarding_complete_password(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_create_client(uuid,text,text),
  public.onboarding_record_email(uuid,uuid), public.onboarding_complete_password(uuid,uuid,text) TO studio_api;
