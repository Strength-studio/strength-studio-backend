-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ADMIN', 'STAFF', 'COACH', 'CLIENT');

-- CreateEnum
CREATE TYPE "account_state" AS ENUM ('INVITED', 'PENDING_VERIFICATION', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "staff_permission" AS ENUM ('client.manage', 'catalog.read', 'catalog.manage', 'catalog.private.manage', 'purchase.read', 'purchase.review', 'purchase.record', 'finance.read', 'installment.manage', 'payment.record', 'payment.verify', 'payment.allocate', 'membership.activate', 'schedule.read', 'schedule.manage', 'availability.decide', 'booking.read', 'booking.assist', 'booking.approve', 'booking.cancel.decide', 'booking.reschedule.decide', 'booking.waitlist.promote', 'attendance.read', 'report.read', 'report.export', 'audit.read');

-- CreateEnum
CREATE TYPE "token_purpose" AS ENUM ('INVITE', 'VERIFY_EMAIL', 'PASSWORD_RESET', 'REFRESH', 'SOCKET');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('ACCOUNT_DISABLED', 'STAFF_GRANT_CHANGED', 'REFRESH_REPLAY', 'SESSION_REVOKED', 'STUDIO_POLICY_PUBLISHED');

-- CreateEnum
CREATE TYPE "audit_target" AS ENUM ('USER', 'STAFF_GRANT', 'AUTH_SESSION', 'POLICY_REVISION');

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalized_email" TEXT NOT NULL,
    "role" "user_role" NOT NULL,
    "account_state" "account_state" NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profile" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "client_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "coach_profile" (
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "display_name" TEXT NOT NULL,

    CONSTRAINT "coach_profile_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "staff_grant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staff_user_id" UUID NOT NULL,
    "permission" "staff_permission" NOT NULL,
    "changed_by" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "staff_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,
    "session_id" UUID,
    "purpose" "token_purpose" NOT NULL,
    "digest" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "singleton_key" TEXT NOT NULL,
    "active_policy_id" UUID,

    CONSTRAINT "studio_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_revision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "studio_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "approved_by" UUID NOT NULL,
    "timezone" TEXT NOT NULL,
    "default_currency" TEXT NOT NULL,
    "rules" JSONB NOT NULL,

    CONSTRAINT "policy_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID,
    "action" "audit_action" NOT NULL,
    "target_type" "audit_target" NOT NULL,
    "target_id" UUID NOT NULL,
    "request_id" TEXT,
    "reason" TEXT,
    "redacted_details" JSONB NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_key" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_digest" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "result_status" INTEGER,
    "result_reference" TEXT,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_normalized_email_key" ON "app_user"("normalized_email");

-- CreateIndex
CREATE INDEX "staff_grant_changed_by_idx" ON "staff_grant"("changed_by");

-- CreateIndex
CREATE UNIQUE INDEX "staff_grant_staff_user_id_permission_key" ON "staff_grant"("staff_user_id", "permission");

-- CreateIndex
CREATE INDEX "auth_session_user_id_revoked_at_expires_at_idx" ON "auth_session"("user_id", "revoked_at", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_id_user_id_key" ON "auth_session"("id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_token_digest_key" ON "auth_token"("digest");

-- CreateIndex
CREATE INDEX "auth_token_session_id_user_id_idx" ON "auth_token"("session_id", "user_id");

-- CreateIndex
CREATE INDEX "auth_token_user_id_purpose_expires_at_idx" ON "auth_token"("user_id", "purpose", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "studio_settings_singleton_key_key" ON "studio_settings"("singleton_key");

-- CreateIndex
CREATE INDEX "policy_revision_approved_by_idx" ON "policy_revision"("approved_by");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_id_studio_id_key" ON "policy_revision"("id", "studio_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_studio_id_version_key" ON "policy_revision"("studio_id", "version");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_created_at_idx" ON "audit_log"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_request_id_idx" ON "audit_log"("request_id");

-- CreateIndex
CREATE INDEX "idempotency_key_expires_at_idx" ON "idempotency_key"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_key_actor_id_operation_key_key" ON "idempotency_key"("actor_id", "operation", "key");

-- AddForeignKey
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coach_profile" ADD CONSTRAINT "coach_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff_grant" ADD CONSTRAINT "staff_grant_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff_grant" ADD CONSTRAINT "staff_grant_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_session_id_user_id_fkey" FOREIGN KEY ("session_id", "user_id") REFERENCES "auth_session"("id", "user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "studio_settings" ADD CONSTRAINT "studio_settings_active_policy_id_id_fkey" FOREIGN KEY ("active_policy_id", "id") REFERENCES "policy_revision"("id", "studio_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_revision" ADD CONSTRAINT "policy_revision_studio_id_fkey" FOREIGN KEY ("studio_id") REFERENCES "studio_settings"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "policy_revision" ADD CONSTRAINT "policy_revision_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;


-- Foundation constraints and grants beyond the Prisma model.
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_purpose_session_check"
  CHECK (("purpose" IN ('REFRESH', 'SOCKET')) = ("session_id" IS NOT NULL));
ALTER TABLE "studio_settings" ADD CONSTRAINT "studio_settings_singleton_check"
  CHECK ("singleton_key" = 'studio');
ALTER TABLE "policy_revision" ADD CONSTRAINT "policy_revision_settings_check"
  CHECK ("version" > 0 AND "default_currency" ~ '^[A-Z]{3}$');
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_success_status_check"
  CHECK ("result_status" BETWEEN 200 AND 299);

INSERT INTO "studio_settings" ("singleton_key") VALUES ('studio');

CREATE SCHEMA "commission_private";
REVOKE ALL ON SCHEMA "commission_private" FROM PUBLIC, studio_api, studio_reporting, studio_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA "commission_private"
  REVOKE ALL ON TABLES FROM PUBLIC, studio_api, studio_reporting, studio_worker;

GRANT USAGE ON SCHEMA public TO studio_api;
GRANT SELECT ON TABLE "app_user", "client_profile", "coach_profile", "staff_grant", "auth_session",
  "auth_token", "studio_settings", "policy_revision", "audit_log", "idempotency_key" TO studio_api;
-- PostgreSQL row locking requires UPDATE privilege on at least one column of a locked table.
GRANT UPDATE ("account_state") ON "app_user" TO studio_api;
GRANT INSERT, UPDATE ON "auth_session", "auth_token", "staff_grant", "idempotency_key" TO studio_api;
GRANT UPDATE ("active_policy_id") ON "studio_settings" TO studio_api;
GRANT INSERT ON "policy_revision", "audit_log" TO studio_api;
