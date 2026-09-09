-- CreateTable
CREATE TABLE `IntakeBatch` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `memberId` VARCHAR(191) NULL,
    `status` ENUM('EXTRACTING', 'REVIEWING', 'APPLIED', 'FAILED', 'DISCARDED') NOT NULL DEFAULT 'EXTRACTING',
    `model` VARCHAR(60) NOT NULL,
    `promptVersion` VARCHAR(20) NOT NULL,
    `inputTokens` INTEGER NOT NULL DEFAULT 0,
    `outputTokens` INTEGER NOT NULL DEFAULT 0,
    `estimatedCostYen` DECIMAL(10, 3) NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IntakeBatch_householdId_status_createdAt_idx`(`householdId`, `status`, `createdAt`),
    INDEX `IntakeBatch_householdId_createdAt_idx`(`householdId`, `createdAt`),
    INDEX `IntakeBatch_householdId_memberId_idx`(`householdId`, `memberId`),
    UNIQUE INDEX `IntakeBatch_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntakeImage` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `kind` ENUM('RECEIPT', 'PURCHASE', 'EXPIRY_LABEL', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `sha256` CHAR(64) NOT NULL,
    `mimeType` VARCHAR(60) NOT NULL,
    `byteSize` INTEGER NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `data` LONGBLOB NULL,
    `retainUntil` DATETIME(3) NULL,
    `purgedAt` DATETIME(3) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IntakeImage_householdId_batchId_sortOrder_idx`(`householdId`, `batchId`, `sortOrder`),
    INDEX `IntakeImage_householdId_retainUntil_idx`(`householdId`, `retainUntil`),
    UNIQUE INDEX `IntakeImage_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `IntakeImage_householdId_sha256_key`(`householdId`, `sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntakeCandidate` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NOT NULL,
    `imageId` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPLIED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `productName` VARCHAR(120) NOT NULL DEFAULT '',
    `brand` VARCHAR(120) NOT NULL DEFAULT '',
    `categoryName` VARCHAR(120) NOT NULL DEFAULT '',
    `amount` DECIMAL(14, 3) NULL,
    `unit` ENUM('PIECE', 'PACK', 'BOTTLE', 'CAN', 'BAG', 'BOX', 'ROLL', 'MILLILITER', 'LITER', 'GRAM', 'KILOGRAM', 'SERVING', 'USE') NOT NULL DEFAULT 'PIECE',
    `storageLocationId` VARCHAR(191) NULL,
    `storagePositionId` VARCHAR(191) NULL,
    `expiryKind` ENUM('UNKNOWN', 'NONE', 'BEST_BEFORE', 'USE_BY') NOT NULL DEFAULT 'UNKNOWN',
    `expiryDate` DATE NULL,
    `opened` BOOLEAN NOT NULL DEFAULT false,
    `note` TEXT NULL,
    `confidence` DECIMAL(4, 3) NULL,
    `productNameConfidence` DECIMAL(4, 3) NULL,
    `amountConfidence` DECIMAL(4, 3) NULL,
    `expiryConfidence` DECIMAL(4, 3) NULL,
    `categoryConfidence` DECIMAL(4, 3) NULL,
    `storageConfidence` DECIMAL(4, 3) NULL,
    `evidence` VARCHAR(500) NULL,
    `fieldSources` JSON NULL,
    `appliedStockLotId` VARCHAR(191) NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `IntakeCandidate_householdId_batchId_status_idx`(`householdId`, `batchId`, `status`),
    INDEX `IntakeCandidate_householdId_imageId_idx`(`householdId`, `imageId`),
    INDEX `IntakeCandidate_householdId_storageLocationId_idx`(`householdId`, `storageLocationId`),
    INDEX `IntakeCandidate_householdId_storagePositionId_idx`(`householdId`, `storagePositionId`),
    UNIQUE INDEX `IntakeCandidate_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IntakeSetting` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `imageRetentionDays` INTEGER NOT NULL DEFAULT 30,
    `sendProductNames` BOOLEAN NOT NULL DEFAULT false,
    `monthlyRequestLimit` INTEGER NOT NULL DEFAULT 100,
    `monthlyCostLimitYen` DECIMAL(10, 2) NOT NULL DEFAULT 1000,
    `stopOnLimit` BOOLEAN NOT NULL DEFAULT true,
    `model` VARCHAR(60) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IntakeSetting_householdId_key`(`householdId`),
    UNIQUE INDEX `IntakeSetting_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `IntakeBatch` ADD CONSTRAINT `IntakeBatch_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeBatch` ADD CONSTRAINT `IntakeBatch_householdId_memberId_fkey` FOREIGN KEY (`householdId`, `memberId`) REFERENCES `HouseholdMember`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `IntakeImage` ADD CONSTRAINT `IntakeImage_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeImage` ADD CONSTRAINT `IntakeImage_householdId_batchId_fkey` FOREIGN KEY (`householdId`, `batchId`) REFERENCES `IntakeBatch`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeCandidate` ADD CONSTRAINT `IntakeCandidate_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeCandidate` ADD CONSTRAINT `IntakeCandidate_householdId_batchId_fkey` FOREIGN KEY (`householdId`, `batchId`) REFERENCES `IntakeBatch`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeCandidate` ADD CONSTRAINT `IntakeCandidate_householdId_imageId_fkey` FOREIGN KEY (`householdId`, `imageId`) REFERENCES `IntakeImage`(`householdId`, `id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IntakeCandidate` ADD CONSTRAINT `IntakeCandidate_householdId_storageLocationId_fkey` FOREIGN KEY (`householdId`, `storageLocationId`) REFERENCES `StorageLocation`(`householdId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `IntakeCandidate` ADD CONSTRAINT `IntakeCandidate_householdId_storageLocationId_storagePositi_fkey` FOREIGN KEY (`householdId`, `storageLocationId`, `storagePositionId`) REFERENCES `StoragePosition`(`householdId`, `storageLocationId`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `IntakeSetting` ADD CONSTRAINT `IntakeSetting_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
