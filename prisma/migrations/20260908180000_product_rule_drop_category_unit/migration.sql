-- カテゴリ・単位の正本を Product へ一本化する（#52）。
-- ProductRule 側の同じ意味の列を落とす前に、学習ルールが覚えている最新の確定値を商品マスタへ移す。
-- （移さずに落とすと、利用者が最後に確定したカテゴリ・単位が失われる。）
UPDATE `Product` `p`
  INNER JOIN `ProductRule` `r`
    ON `r`.`householdId` = `p`.`householdId` AND `r`.`productId` = `p`.`id`
SET `p`.`categoryId` = `r`.`categoryId`
WHERE `r`.`categoryId` IS NOT NULL
  AND (`p`.`categoryId` IS NULL OR `p`.`categoryId` <> `r`.`categoryId`);

UPDATE `Product` `p`
  INNER JOIN `ProductRule` `r`
    ON `r`.`householdId` = `p`.`householdId` AND `r`.`productId` = `p`.`id`
SET `p`.`defaultUnit` = `r`.`unit`
WHERE `r`.`unit` IS NOT NULL AND `p`.`defaultUnit` <> `r`.`unit`;

-- DropForeignKey
ALTER TABLE `ProductRule` DROP FOREIGN KEY `ProductRule_householdId_categoryId_fkey`;

-- DropIndex
DROP INDEX `ProductRule_householdId_categoryId_idx` ON `ProductRule`;

-- AlterTable
ALTER TABLE `ProductRule` DROP COLUMN `categoryId`,
    DROP COLUMN `unit`;
