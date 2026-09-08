-- CreateTable
CREATE TABLE `ReplenishmentRule` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `thresholdAmount` DECIMAL(14, 3) NOT NULL,
    `targetAmount` DECIMAL(14, 3) NOT NULL,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ReplenishmentRule_householdId_enabled_idx`(`householdId`, `enabled`),
    UNIQUE INDEX `ReplenishmentRule_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `ReplenishmentRule_householdId_productId_key`(`householdId`, `productId`),
    UNIQUE INDEX `ReplenishmentRule_householdId_categoryId_key`(`householdId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShoppingListEntry` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NULL,
    `categoryId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `shortageAmount` DECIMAL(14, 3) NOT NULL,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NOT NULL,
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `notionPageId` VARCHAR(191) NULL,
    `notionUrl` TEXT NULL,
    `lastError` TEXT NULL,
    `sendingStartedAt` DATETIME(3) NULL,
    `lastSentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShoppingListEntry_householdId_status_idx`(`householdId`, `status`),
    UNIQUE INDEX `ShoppingListEntry_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `ShoppingListEntry_householdId_productId_key`(`householdId`, `productId`),
    UNIQUE INDEX `ShoppingListEntry_householdId_categoryId_key`(`householdId`, `categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReplenishmentRule` ADD CONSTRAINT `ReplenishmentRule_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplenishmentRule` ADD CONSTRAINT `ReplenishmentRule_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReplenishmentRule` ADD CONSTRAINT `ReplenishmentRule_householdId_categoryId_fkey` FOREIGN KEY (`householdId`, `categoryId`) REFERENCES `Category`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShoppingListEntry` ADD CONSTRAINT `ShoppingListEntry_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShoppingListEntry` ADD CONSTRAINT `ShoppingListEntry_householdId_productId_fkey` FOREIGN KEY (`householdId`, `productId`) REFERENCES `Product`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShoppingListEntry` ADD CONSTRAINT `ShoppingListEntry_householdId_categoryId_fkey` FOREIGN KEY (`householdId`, `categoryId`) REFERENCES `Category`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

