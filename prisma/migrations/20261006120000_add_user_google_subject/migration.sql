-- AlterTable
ALTER TABLE `User` ADD COLUMN `googleSubject` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_googleSubject_key` ON `User`(`googleSubject`);
