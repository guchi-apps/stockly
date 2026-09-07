-- CreateTable
CREATE TABLE `Category` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('FOOD', 'DRINK', 'DAILY', 'EMERGENCY', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Category_householdId_parentId_idx`(`householdId`, `parentId`),
    UNIQUE INDEX `Category_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `Category_householdId_name_key`(`householdId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `brand` VARCHAR(191) NOT NULL DEFAULT '',
    `note` TEXT NULL,
    `defaultUnit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NOT NULL DEFAULT 'PIECE',
    `contentAmount` DECIMAL(14, 3) NULL,
    `contentUnit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NULL,
    `servingsPerUnit` DECIMAL(14, 3) NULL,
    `usesPerUnit` DECIMAL(14, 3) NULL,
    `temperatureZone` ENUM('AMBIENT', 'CHILLED', 'FROZEN') NOT NULL DEFAULT 'AMBIENT',
    `requiresHeating` BOOLEAN NOT NULL DEFAULT false,
    `requiresWater` BOOLEAN NOT NULL DEFAULT false,
    `emergencyRole` ENUM('NONE', 'STAPLE_FOOD', 'SIDE_DISH', 'DRINKING_WATER', 'UTILITY_WATER', 'HEAT_SOURCE', 'SANITATION', 'MEDICAL', 'OTHER') NOT NULL DEFAULT 'NONE',
    `disasterAttributes` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Product_householdId_categoryId_idx`(`householdId`, `categoryId`),
    INDEX `Product_householdId_emergencyRole_idx`(`householdId`, `emergencyRole`),
    UNIQUE INDEX `Product_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `Product_householdId_name_brand_key`(`householdId`, `name`, `brand`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductAlias` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(191) NOT NULL,
    `source` ENUM('MANUAL', 'RECEIPT', 'BARCODE', 'AI') NOT NULL DEFAULT 'MANUAL',
    `confidence` DECIMAL(4, 3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductAlias_householdId_productId_idx`(`householdId`, `productId`),
    UNIQUE INDEX `ProductAlias_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `ProductAlias_householdId_alias_key`(`householdId`, `alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Barcode` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `symbology` ENUM('JAN', 'EAN13', 'EAN8', 'UPC_A', 'CODE128', 'QR', 'OTHER') NOT NULL DEFAULT 'JAN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Barcode_householdId_productId_idx`(`householdId`, `productId`),
    UNIQUE INDEX `Barcode_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `Barcode_householdId_code_key`(`householdId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageLocation` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('REFRIGERATOR', 'FREEZER', 'PANTRY', 'CUPBOARD', 'CLOSET', 'EMERGENCY_STOCK', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `temperatureZone` ENUM('AMBIENT', 'CHILLED', 'FROZEN') NOT NULL DEFAULT 'AMBIENT',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StorageLocation_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `StorageLocation_householdId_name_key`(`householdId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StoragePosition` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `storageLocationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StoragePosition_householdId_storageLocationId_idx`(`householdId`, `storageLocationId`),
    UNIQUE INDEX `StoragePosition_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `StoragePosition_householdId_storageLocationId_name_key`(`householdId`, `storageLocationId`, `name`),
    UNIQUE INDEX `StoragePosition_householdId_storageLocationId_id_key`(`householdId`, `storageLocationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLot` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `storageLocationId` VARCHAR(191) NULL,
    `storagePositionId` VARCHAR(191) NULL,
    `quantity` DECIMAL(14, 3) NOT NULL DEFAULT 0,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NOT NULL,
    `bestBeforeDate` DATE NULL,
    `useByDate` DATE NULL,
    `openedAt` DATETIME(3) NULL,
    `acquiredAt` DATETIME(3) NULL,
    `status` ENUM('ACTIVE', 'DEPLETED', 'DISCARDED') NOT NULL DEFAULT 'ACTIVE',
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StockLot_householdId_productId_status_idx`(`householdId`, `productId`, `status`),
    INDEX `StockLot_householdId_storageLocationId_idx`(`householdId`, `storageLocationId`),
    INDEX `StockLot_householdId_storagePositionId_idx`(`householdId`, `storagePositionId`),
    INDEX `StockLot_householdId_status_bestBeforeDate_idx`(`householdId`, `status`, `bestBeforeDate`),
    INDEX `StockLot_householdId_status_useByDate_idx`(`householdId`, `status`, `useByDate`),
    UNIQUE INDEX `StockLot_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `stockLotId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NULL,
    `type` ENUM('PURCHASE', 'CONSUME', 'DISPOSE', 'ADJUST', 'REVERSAL') NOT NULL,
    `quantityDelta` DECIMAL(14, 3) NOT NULL,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NOT NULL,
    `reversesTransactionId` VARCHAR(191) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `recordedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `note` TEXT NULL,

    INDEX `InventoryTransaction_householdId_stockLotId_occurredAt_idx`(`householdId`, `stockLotId`, `occurredAt`),
    INDEX `InventoryTransaction_householdId_productId_occurredAt_idx`(`householdId`, `productId`, `occurredAt`),
    INDEX `InventoryTransaction_householdId_occurredAt_idx`(`householdId`, `occurredAt`),
    INDEX `InventoryTransaction_householdId_memberId_idx`(`householdId`, `memberId`),
    UNIQUE INDEX `InventoryTransaction_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `InventoryTransaction_householdId_reversesTransactionId_key`(`householdId`, `reversesTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `HouseholdMember_householdId_id_key` ON `HouseholdMember`(`householdId`, `id`);

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_householdId_parentId_fkey` FOREIGN KEY (`householdId`, `parentId`) REFERENCES `Category`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_householdId_categoryId_fkey` FOREIGN KEY (`householdId`, `categoryId`) REFERENCES `Category`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `ProductAlias` ADD CONSTRAINT `ProductAlias_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductAlias` ADD CONSTRAINT `ProductAlias_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Barcode` ADD CONSTRAINT `Barcode_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Barcode` ADD CONSTRAINT `Barcode_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorageLocation` ADD CONSTRAINT `StorageLocation_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoragePosition` ADD CONSTRAINT `StoragePosition_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StoragePosition` ADD CONSTRAINT `StoragePosition_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `StorageLocation`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLot` ADD CONSTRAINT `StockLot_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLot` ADD CONSTRAINT `StockLot_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `StockLot` ADD CONSTRAINT `StockLot_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `StorageLocation`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `StockLot` ADD CONSTRAINT `StockLot_householdId_storageLocationId_storagePositionId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`, `storagePositionId`) REFERENCES `StoragePosition`(`householdId`, `storageLocationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_householdId_stockLotId_fkey` FOREIGN KEY (`householdId`, `stockLotId`) REFERENCES `StockLot`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_householdId_memberId_fkey` FOREIGN KEY (`householdId`, `memberId`) REFERENCES `HouseholdMember`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_householdId_reversesTransactionId_fkey` FOREIGN KEY (`householdId`, `reversesTransactionId`) REFERENCES `InventoryTransaction`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

