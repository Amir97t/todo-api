-- Created before the column type change; Prisma's datasource `extensions`
-- would require the postgresqlExtensions preview feature.
CREATE EXTENSION IF NOT EXISTS citext;

-- AlterTable
ALTER TABLE "List" ALTER COLUMN "name" SET DATA TYPE CITEXT;

-- CreateIndex
CREATE UNIQUE INDEX "List_name_key" ON "List"("name");

-- CreateIndex
CREATE INDEX "Task_listId_completed_createdAt_idx" ON "Task"("listId", "completed", "createdAt");

-- DropIndex
DROP INDEX "Task_listId_idx";

-- Fixed system Inbox row. ON CONFLICT keeps this idempotent if re-applied.
INSERT INTO "List" ("id", "name", "icon", "createdAt", "updatedAt")
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'Inbox',
    'inbox',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
