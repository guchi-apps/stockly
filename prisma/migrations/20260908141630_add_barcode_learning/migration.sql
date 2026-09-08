-- AlterTable
ALTER TABLE `Barcode` ADD COLUMN `fetchedAt` DATETIME(3) NULL,
    ADD COLUMN `lastUsedAt` DATETIME(3) NULL,
    ADD COLUMN `mismatchCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `source` ENUM('SCAN', 'MANUAL', 'EXTERNAL') NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `sourceName` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `sourcePayload` JSON NULL,
    ADD COLUMN `useCount` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `ProductRule` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NULL,
    `storageLocationId` VARCHAR(191) NULL,
    `storagePositionId` VARCHAR(191) NULL,
    `expiryKind` ENUM('NONE', 'BEST_BEFORE', 'USE_BY') NOT NULL DEFAULT 'NONE',
    `shelfLifeDays` INTEGER NULL,
    `confirmedCount` INTEGER NOT NULL DEFAULT 0,
    `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductRule_householdId_categoryId_idx`(`householdId`, `categoryId`),
    INDEX `ProductRule_householdId_storageLocationId_idx`(`householdId`, `storageLocationId`),
    INDEX `ProductRule_householdId_storagePositionId_idx`(`householdId`, `storagePositionId`),
    UNIQUE INDEX `ProductRule_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `ProductRule_householdId_productId_key`(`householdId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductRule` ADD CONSTRAINT `ProductRule_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductRule` ADD CONSTRAINT `ProductRule_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductRule` ADD CONSTRAINT `ProductRule_householdId_categoryId_fkey` FOREIGN KEY (`householdId`, `categoryId`) REFERENCES `Category`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ProductRule` ADD CONSTRAINT `ProductRule_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `StorageLocation`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ProductRule` ADD CONSTRAINT `ProductRule_householdId_storageLocationId_storagePositionId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`, `storagePositionId`) REFERENCES `StoragePosition`(`householdId`, `storageLocationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
