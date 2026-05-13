-- AlterTable
ALTER TABLE "shifts" ADD COLUMN     "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "closed_by_user_id" UUID;

-- CreateIndex
CREATE INDEX "shifts_register_id_closed_at_idx" ON "shifts"("register_id", "closed_at");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
