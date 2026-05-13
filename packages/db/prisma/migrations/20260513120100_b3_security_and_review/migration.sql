-- AlterTable: tenants — settings de seguridad y cajero
ALTER TABLE "tenants" ADD COLUMN     "cashier_auto_logout_minutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "require_manager_pin_for_force_close" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "device_new_login_alert_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: users — 2FA TOTP + recovery codes
ALTER TABLE "users" ADD COLUMN     "two_factor_secret" TEXT,
ADD COLUMN     "two_factor_enabled_at" TIMESTAMPTZ,
ADD COLUMN     "two_factor_recovery_codes" JSONB;

-- AlterTable: devices — alertas geoip
ALTER TABLE "devices" ADD COLUMN     "last_known_ip_country" TEXT,
ADD COLUMN     "last_email_alert_at" TIMESTAMPTZ;

-- AlterTable: products — contador de intentos de SKU review
ALTER TABLE "products" ADD COLUMN     "sku_review_attempts" INTEGER NOT NULL DEFAULT 0;
