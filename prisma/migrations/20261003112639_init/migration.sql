-- CreateTable
CREATE TABLE "List" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "listId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "taskId" UUID NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_listId_idx" ON "Task"("listId");

-- CreateIndex
CREATE INDEX "Task_completed_idx" ON "Task"("completed");

-- CreateIndex
CREATE INDEX "ChecklistItem_taskId_position_idx" ON "ChecklistItem"("taskId", "position");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
