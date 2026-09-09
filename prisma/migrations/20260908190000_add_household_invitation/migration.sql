-- CreateTable
CREATE TABLE `HouseholdInvitation` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `invitedByUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `HouseholdInvitation_householdId_email_idx`(`householdId`, `email`),
    INDEX `HouseholdInvitation_invitedByUserId_idx`(`invitedByUserId`),
    UNIQUE INDEX `HouseholdInvitation_tokenHash_key`(`tokenHash`),
    UNIQUE INDEX `HouseholdInvitation_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `HouseholdInvitation` ADD CONSTRAINT `HouseholdInvitation_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HouseholdInvitation` ADD CONSTRAINT `HouseholdInvitation_invitedByUserId_fkey` FOREIGN KEY (`invitedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- 除名・脱退で行を消さず「外れた印」を付ける（履歴が記録者としてこの行を参照しているため）。
ALTER TABLE `HouseholdMember` ADD COLUMN `removedAt` DATETIME(3) NULL;
