-- Replaced by the unique constraint below: both are btree indexes on
-- (taskId, position), so the plain index no longer serves any query the
-- unique index cannot.
DROP INDEX "ChecklistItem_taskId_position_idx";

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_taskId_position_key" ON "ChecklistItem"("taskId", "position");
