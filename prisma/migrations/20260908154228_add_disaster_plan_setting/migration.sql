-- AlterTable
ALTER TABLE `Product` MODIFY `emergencyRole` ENUM('NONE', 'STAPLE_FOOD', 'SIDE_DISH', 'DRINKING_WATER', 'UTILITY_WATER', 'HEAT_SOURCE', 'SANITATION', 'LIGHTING', 'POWER', 'MEDICAL', 'OTHER') NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE `DisasterPlanSetting` (
    `id` VARCHAR(191) NOT NULL,
    `householdId` VARCHAR(191) NOT NULL,
    `peopleCount` INTEGER NOT NULL DEFAULT 2,
    `targetDays` INTEGER NOT NULL DEFAULT 3,
    `waterLitersPerPersonDay` DECIMAL(14, 3) NOT NULL DEFAULT 3,
    `foodServingsPerPersonDay` DECIMAL(14, 3) NOT NULL DEFAULT 3,
    `sanitationUsesPerPersonDay` DECIMAL(14, 3) NOT NULL DEFAULT 5,
    `lightingUnitsPerPerson` DECIMAL(14, 3) NOT NULL DEFAULT 1,
    `powerUnitsPerPerson` DECIMAL(14, 3) NOT NULL DEFAULT 1,
    `heatSourceUsesPerDay` DECIMAL(14, 3) NOT NULL DEFAULT 1,
    `includeChilled` BOOLEAN NOT NULL DEFAULT false,
    `includeFrozen` BOOLEAN NOT NULL DEFAULT false,
    `includeOpened` BOOLEAN NOT NULL DEFAULT false,
    `requireHeatSourceForHeating` BOOLEAN NOT NULL DEFAULT true,
    `requireWaterForRehydration` BOOLEAN NOT NULL DEFAULT true,
    `ruleVersion` VARCHAR(20) NOT NULL DEFAULT 'v1',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DisasterPlanSetting_householdId_key`(`householdId`),
    UNIQUE INDEX `DisasterPlanSetting_householdId_id_key`(`householdId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DisasterPlanSetting` ADD CONSTRAINT `DisasterPlanSetting_householdId_fkey` FOREIGN KEY (`householdId`) REFERENCES `Household`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
