-- CreateTable
CREATE TABLE `DisasterBag` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `storageLocationId` VARCHAR(191) NOT NULL,
    `peopleCount` INTEGER NOT NULL DEFAULT 1,
    `targetDays` INTEGER NOT NULL DEFAULT 1,
    `inspectionIntervalDays` INTEGER NOT NULL DEFAULT 180,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DisasterBag_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `DisasterBag_householdId_storageLocationId_key`(`householdId`, `storageLocationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DisasterBagInspection` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `disasterBagId` VARCHAR(191) NOT NULL,
    `inspectedOn` DATE NOT NULL,
    `note` VARCHAR(500) NULL,
    `itemCount` INTEGER NOT NULL DEFAULT 0,
    `expiredCount` INTEGER NOT NULL DEFAULT 0,
    `expiringSoonCount` INTEGER NOT NULL DEFAULT 0,
    `unknownExpiryCount` INTEGER NOT NULL DEFAULT 0,
    `ruleVersion` VARCHAR(20) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DisasterBagInspection_householdId_disasterBagId_inspectedOn_idx`(`householdId`, `disasterBagId`, `inspectedOn`),
    UNIQUE INDEX `DisasterBagInspection_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DisasterBag` ADD CONSTRAINT `DisasterBag_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisasterBag` ADD CONSTRAINT `DisasterBag_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `StorageLocation`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisasterBagInspection` ADD CONSTRAINT `DisasterBagInspection_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DisasterBagInspection` ADD CONSTRAINT `DisasterBagInspection_householdId_disasterBagId_fkey` FOREIGN KEY (`householdId`, `disasterBagId`) REFERENCES `DisasterBag`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
