-- CreateTable
CREATE TABLE `households` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `members` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `authUserId` VARCHAR(191) NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `members_authUserId_key`(`authUserId`),
    INDEX `members_householdId_idx`(`householdId`),
    UNIQUE INDEX `members_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `categories` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('FOOD', 'DRINK', 'DAILY', 'EMERGENCY', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `categories_householdId_parentId_idx`(`householdId`, `parentId`),
    UNIQUE INDEX `categories_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `categories_householdId_name_key`(`householdId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
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

    INDEX `products_householdId_categoryId_idx`(`householdId`, `categoryId`),
    INDEX `products_householdId_emergencyRole_idx`(`householdId`, `emergencyRole`),
    UNIQUE INDEX `products_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `products_householdId_name_brand_key`(`householdId`, `name`, `brand`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_aliases` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `alias` VARCHAR(191) NOT NULL,
    `source` ENUM('MANUAL', 'RECEIPT', 'BARCODE', 'AI') NOT NULL DEFAULT 'MANUAL',
    `confidence` DECIMAL(4, 3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `product_aliases_householdId_productId_idx`(`householdId`, `productId`),
    UNIQUE INDEX `product_aliases_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `product_aliases_householdId_alias_key`(`householdId`, `alias`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `barcodes` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `symbology` ENUM('JAN', 'EAN13', 'EAN8', 'UPC_A', 'CODE128', 'QR', 'OTHER') NOT NULL DEFAULT 'JAN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `barcodes_householdId_productId_idx`(`householdId`, `productId`),
    UNIQUE INDEX `barcodes_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `barcodes_householdId_code_key`(`householdId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `storage_locations` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `kind` ENUM('REFRIGERATOR', 'FREEZER', 'PANTRY', 'CUPBOARD', 'CLOSET', 'EMERGENCY_STOCK', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `temperatureZone` ENUM('AMBIENT', 'CHILLED', 'FROZEN') NOT NULL DEFAULT 'AMBIENT',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `storage_locations_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `storage_locations_householdId_name_key`(`householdId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `storage_positions` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `storageLocationId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `storage_positions_householdId_storageLocationId_idx`(`householdId`, `storageLocationId`),
    UNIQUE INDEX `storage_positions_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `storage_positions_householdId_storageLocationId_name_key`(`householdId`, `storageLocationId`, `name`),
    UNIQUE INDEX `storage_positions_householdId_storageLocationId_id_key`(`householdId`, `storageLocationId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_lots` (
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

    INDEX `stock_lots_householdId_productId_status_idx`(`householdId`, `productId`, `status`),
    INDEX `stock_lots_householdId_storageLocationId_idx`(`householdId`, `storageLocationId`),
    INDEX `stock_lots_householdId_storagePositionId_idx`(`householdId`, `storagePositionId`),
    INDEX `stock_lots_householdId_status_bestBeforeDate_idx`(`householdId`, `status`, `bestBeforeDate`),
    INDEX `stock_lots_householdId_status_useByDate_idx`(`householdId`, `status`, `useByDate`),
    UNIQUE INDEX `stock_lots_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_transactions` (
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

    INDEX `inventory_transactions_householdId_stockLotId_occurredAt_idx`(`householdId`, `stockLotId`, `occurredAt`),
    INDEX `inventory_transactions_householdId_productId_occurredAt_idx`(`householdId`, `productId`, `occurredAt`),
    INDEX `inventory_transactions_householdId_occurredAt_idx`(`householdId`, `occurredAt`),
    INDEX `inventory_transactions_householdId_memberId_idx`(`householdId`, `memberId`),
    UNIQUE INDEX `inventory_transactions_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `inventory_transactions_householdId_reversesTransactionId_key`(`householdId`, `reversesTransactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `members` ADD CONSTRAINT `members_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `categories` ADD CONSTRAINT `categories_householdId_parentId_fkey` FOREIGN KEY (`householdId`, `parentId`) REFERENCES `categories`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_householdId_categoryId_fkey` FOREIGN KEY (`householdId`, `categoryId`) REFERENCES `categories`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `product_aliases` ADD CONSTRAINT `product_aliases_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_aliases` ADD CONSTRAINT `product_aliases_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `products`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `barcodes` ADD CONSTRAINT `barcodes_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `barcodes` ADD CONSTRAINT `barcodes_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `products`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_locations` ADD CONSTRAINT `storage_locations_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_positions` ADD CONSTRAINT `storage_positions_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `storage_positions` ADD CONSTRAINT `storage_positions_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `storage_locations`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `products`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `storage_locations`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_householdId_storageLocationId_storagePositionId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`, `storagePositionId`) REFERENCES `storage_positions`(`householdId`, `storageLocationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `households`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_householdId_stockLotId_fkey` FOREIGN KEY (`householdId`, `stockLotId`) REFERENCES `stock_lots`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `products`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_householdId_memberId_fkey` FOREIGN KEY (`householdId`, `memberId`) REFERENCES `members`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_householdId_reversesTransactionId_fkey` FOREIGN KEY (`householdId`, `reversesTransactionId`) REFERENCES `inventory_transactions`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

