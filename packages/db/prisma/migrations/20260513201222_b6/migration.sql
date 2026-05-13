/*
  Warnings:

  - The `method` column on the `refunds` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "refund_lines" ALTER COLUMN "discount_pct" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "refunds" DROP COLUMN "method",
ADD COLUMN     "method" "PaymentMethod";

-- AlterTable
ALTER TABLE "tickets" ALTER COLUMN "print_intent" SET DEFAULT true;

-- RenameForeignKey
ALTER TABLE "ticket_email_jobs" RENAME CONSTRAINT "ticket_email_jobs_user_id_fkey" TO "ticket_email_jobs_requested_by_user_id_fkey";
