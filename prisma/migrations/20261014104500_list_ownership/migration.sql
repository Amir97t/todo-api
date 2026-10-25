-- AlterTable
-- Optional ownership (C4-1a): userId stays NULL for existing rows — no
-- backfill, no reassignment. isInbox defaults to false for every row;
-- only the fixed-ID legacy system Inbox is marked true below.
ALTER TABLE "List" ADD COLUMN "userId" UUID,
ADD COLUMN "isInbox" BOOLEAN NOT NULL DEFAULT false;

-- DropIndex
-- The old global CITEXT unique on name is replaced by two constraints:
-- per-user uniqueness (List_userId_name_key) and legacy name uniqueness
-- for unowned lists (List_name_legacy_key).
DROP INDEX "List_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "List_userId_name_key" ON "List"("userId", "name");

-- CreateIndex
-- At most one Inbox per user; NULL userId rows are not constrained here.
CREATE UNIQUE INDEX "List_userId_inbox_key" ON "List"("userId") WHERE ("isInbox" = true);

-- CreateIndex
-- Preserves pre-ownership name uniqueness for unowned lists (userId IS NULL).
CREATE UNIQUE INDEX "List_name_legacy_key" ON "List"("name") WHERE ("userId" IS NULL);

-- AddForeignKey
ALTER TABLE "List" ADD CONSTRAINT "List_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: mark the fixed-ID legacy system Inbox row (see the 20261004094720
-- seed migration). userId is left NULL; no other rows are touched.
UPDATE "List" SET "isInbox" = true WHERE "id" = '00000000-0000-4000-8000-000000000001';
