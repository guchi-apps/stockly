-- CreateTable
CREATE TABLE `ConsumptionScan` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EMPTY_CONTAINER', 'REMAINING', 'SHELF') NOT NULL,
    `status` ENUM('READY', 'FAILED') NOT NULL DEFAULT 'READY',
    `imageFingerprint` VARCHAR(64) NOT NULL,
    `imageCount` INTEGER NOT NULL DEFAULT 0,
    `model` VARCHAR(80) NOT NULL DEFAULT '',
    `ruleVersion` VARCHAR(20) NOT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ConsumptionScan_householdId_createdAt_idx`(`householdId`, `createdAt`),
    UNIQUE INDEX `ConsumptionScan_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `ConsumptionScan_householdId_imageFingerprint_key`(`householdId`, `imageFingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsumptionScanItem` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `scanId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `stockLotId` VARCHAR(191) NULL,
    `detectedLabel` VARCHAR(200) NOT NULL,
    `detectedBarcode` VARCHAR(64) NULL,
    `proposedAmount` DECIMAL(14, 3) NULL,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NULL,
    `aiConfidence` DECIMAL(4, 3) NOT NULL DEFAULT 0,
    `confidence` DECIMAL(4, 3) NOT NULL DEFAULT 0,
    `skipReason` ENUM('NO_PRODUCT', 'NO_STOCK', 'NO_AMOUNT', 'UNIT_MISMATCH') NULL,
    `evidence` JSON NULL,
    `status` ENUM('PENDING', 'CONFIRMED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `transactionId` VARCHAR(191) NULL,
    `confirmedAmount` DECIMAL(14, 3) NULL,
    `confirmedAt` DATETIME(3) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ConsumptionScanItem_householdId_scanId_sortOrder_idx`(`householdId`, `scanId`, `sortOrder`),
    INDEX `ConsumptionScanItem_householdId_productId_idx`(`householdId`, `productId`),
    INDEX `ConsumptionScanItem_householdId_stockLotId_idx`(`householdId`, `stockLotId`),
    UNIQUE INDEX `ConsumptionScanItem_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `ConsumptionScanItem_householdId_transactionId_key`(`householdId`, `transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ConsumptionScan` ADD CONSTRAINT `ConsumptionScan_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumptionScanItem` ADD CONSTRAINT `ConsumptionScanItem_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumptionScanItem` ADD CONSTRAINT `ConsumptionScanItem_householdId_scanId_fkey` FOREIGN KEY (`householdId`, `scanId`) REFERENCES `ConsumptionScan`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumptionScanItem` ADD CONSTRAINT `ConsumptionScanItem_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumptionScanItem` ADD CONSTRAINT `ConsumptionScanItem_householdId_stockLotId_fkey` FOREIGN KEY (`householdId`, `stockLotId`) REFERENCES `StockLot`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumptionScanItem` ADD CONSTRAINT `ConsumptionScanItem_householdId_transactionId_fkey` FOREIGN KEY (`householdId`, `transactionId`) REFERENCES `InventoryTransaction`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;
