-- CreateTable
CREATE TABLE `ExpirySetting` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `bestBeforeSoonDays` INTEGER NOT NULL DEFAULT 7,
    `useBySoonDays` INTEGER NOT NULL DEFAULT 3,
    `highlightUnknownExpiry` BOOLEAN NOT NULL DEFAULT true,
    `notifyEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ExpirySetting_householdId_key`(`householdId`),
    UNIQUE INDEX `ExpirySetting_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `kind` ENUM('EXPIRY') NOT NULL DEFAULT 'EXPIRY',
    `channel` ENUM('IN_APP', 'LOG') NOT NULL,
    `dedupeKey` VARCHAR(120) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `payload` JSON NULL,
    `status` ENUM('SENT', 'FAILED') NOT NULL DEFAULT 'SENT',
    `error` TEXT NULL,
    `suppressedCount` INTEGER NOT NULL DEFAULT 0,
    `lastSuppressedAt` DATETIME(3) NULL,
    `sentAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,

    INDEX `NotificationDelivery_householdId_kind_sentAt_idx`(`householdId`, `kind`, `sentAt`),
    UNIQUE INDEX `NotificationDelivery_householdId_id_key`(`householdId`, `id`),
    UNIQUE INDEX `NotificationDelivery_householdId_channel_dedupeKey_key`(`householdId`, `channel`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ExpirySetting` ADD CONSTRAINT `ExpirySetting_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationDelivery` ADD CONSTRAINT `NotificationDelivery_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
