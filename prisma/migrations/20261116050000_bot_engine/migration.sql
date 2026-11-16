-- BotRun: mỗi ngày 1 phiên cho chế độ thử và 1 phiên cho chế độ thật
-- MySQL cần gỡ FK trước khi xoá index đang phục vụ FK, sau đó tạo lại FK.
ALTER TABLE `BotRun` DROP FOREIGN KEY `BotRun_botId_fkey`;
DROP INDEX `BotRun_botId_runDate_key` ON `BotRun`;
CREATE UNIQUE INDEX `BotRun_botId_runDate_dryRun_key` ON `BotRun`(`botId`, `runDate`, `dryRun`);
ALTER TABLE `BotRun` ADD CONSTRAINT `BotRun_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Bot: nhịp chạy & tỉ lệ trả thưởng (giả lập)
ALTER TABLE `Bot` ADD COLUMN `payoutPercent` DECIMAL(5, 2) NOT NULL DEFAULT 95,
    ADD COLUMN `roundDelaySec` INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN `settleDelaySec` INTEGER NOT NULL DEFAULT 0;

-- Order: lệnh giả lập & lỗi
ALTER TABLE `Order` ADD COLUMN `error` TEXT NULL,
    ADD COLUMN `simulated` BOOLEAN NOT NULL DEFAULT false;
