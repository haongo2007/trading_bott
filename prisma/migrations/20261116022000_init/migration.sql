-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('ADMIN', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'OPERATOR',
    `totpSecret` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TradingAccount` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `platformName` VARCHAR(191) NOT NULL,
    `loginUrl` VARCHAR(2048) NOT NULL,
    `tradeUrl` VARCHAR(2048) NOT NULL,
    `usernameEnc` TEXT NOT NULL,
    `passwordEnc` TEXT NOT NULL,
    `loginMethod` ENUM('FORM', 'SESSION') NOT NULL DEFAULT 'FORM',
    `usernameSelector` VARCHAR(1024) NULL,
    `passwordSelector` VARCHAR(1024) NULL,
    `submitSelector` VARCHAR(1024) NULL,
    `successSelector` VARCHAR(1024) NULL,
    `balanceSelector` VARCHAR(1024) NULL,
    `storageStateEnc` LONGTEXT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'VND',
    `viewportWidth` INTEGER NOT NULL DEFAULT 1366,
    `viewportHeight` INTEGER NOT NULL DEFAULT 768,
    `locale` VARCHAR(191) NOT NULL DEFAULT 'vi-VN',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    `loginTimeoutSec` INTEGER NOT NULL DEFAULT 30,
    `maxLoginRetries` INTEGER NOT NULL DEFAULT 2,
    `status` ENUM('UNVERIFIED', 'ACTIVE', 'LOGIN_FAILED', 'DISABLED') NOT NULL DEFAULT 'UNVERIFIED',
    `lastLoginAt` DATETIME(3) NULL,
    `lastBalance` DECIMAL(18, 2) NULL,
    `lastError` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Flow` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `startUrl` VARCHAR(2048) NULL,
    `graph` JSON NOT NULL,
    `elements` JSON NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Bot` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `flowId` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `dryRun` BOOLEAN NOT NULL DEFAULT true,
    `cron` VARCHAR(191) NOT NULL DEFAULT '0 9 * * *',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    `windowStart` VARCHAR(191) NULL,
    `windowEnd` VARCHAR(191) NULL,
    `dailyBudget` DECIMAL(18, 2) NOT NULL,
    `stakeMode` ENUM('FIXED', 'PERCENT_BALANCE', 'MARTINGALE', 'ANTI_MARTINGALE', 'SEQUENCE') NOT NULL DEFAULT 'FIXED',
    `stakeConfig` JSON NOT NULL,
    `maxStake` DECIMAL(18, 2) NOT NULL,
    `directionMode` ENUM('FIXED', 'FOLLOW_LAST', 'REVERSE_LAST', 'PATTERN', 'RANDOM', 'RULE', 'AI') NOT NULL DEFAULT 'FIXED',
    `directionConfig` JSON NOT NULL,
    `takeProfitType` ENUM('AMOUNT', 'PERCENT') NOT NULL DEFAULT 'AMOUNT',
    `takeProfitValue` DECIMAL(18, 2) NOT NULL,
    `stopLossType` ENUM('AMOUNT', 'PERCENT') NOT NULL DEFAULT 'AMOUNT',
    `stopLossValue` DECIMAL(18, 2) NOT NULL,
    `maxConsecutiveLoss` INTEGER NOT NULL DEFAULT 5,
    `maxOrdersPerDay` INTEGER NOT NULL DEFAULT 50,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Bot_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotRun` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NOT NULL,
    `runDate` DATE NOT NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'WAITING_HUMAN', 'COMPLETED', 'STOPPED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `stopReason` ENUM('TAKE_PROFIT', 'STOP_LOSS', 'MAX_CONSECUTIVE_LOSS', 'MAX_ORDERS', 'BUDGET_EXHAUSTED', 'WINDOW_ENDED', 'MANUAL', 'KILL_SWITCH', 'ERROR') NULL,
    `dryRun` BOOLEAN NOT NULL,
    `startBalance` DECIMAL(18, 2) NULL,
    `endBalance` DECIMAL(18, 2) NULL,
    `targetAmount` DECIMAL(18, 2) NULL,
    `lossLimit` DECIMAL(18, 2) NULL,
    `pnl` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `endedAt` DATETIME(3) NULL,

    UNIQUE INDEX `BotRun_botId_runDate_key`(`botId`, `runDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `seq` INTEGER NOT NULL,
    `direction` ENUM('UP', 'DOWN') NOT NULL,
    `amount` DECIMAL(18, 2) NOT NULL,
    `result` ENUM('PENDING', 'WIN', 'LOSS', 'DRAW', 'UNKNOWN') NOT NULL DEFAULT 'PENDING',
    `balanceBefore` DECIMAL(18, 2) NULL,
    `balanceAfter` DECIMAL(18, 2) NULL,
    `pnl` DECIMAL(18, 2) NULL,
    `screenshot` VARCHAR(1024) NULL,
    `placedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,

    UNIQUE INDEX `Order_runId_seq_key`(`runId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiPrediction` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `direction` ENUM('UP', 'DOWN') NOT NULL,
    `confidence` DOUBLE NOT NULL,
    `reasoning` TEXT NULL,
    `latencyMs` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AiPrediction_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RunLog` (
    `id` VARCHAR(191) NOT NULL,
    `runId` VARCHAR(191) NOT NULL,
    `level` ENUM('DEBUG', 'INFO', 'WARN', 'ERROR') NOT NULL DEFAULT 'INFO',
    `step` VARCHAR(191) NULL,
    `message` TEXT NOT NULL,
    `screenshot` VARCHAR(1024) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RunLog_runId_createdAt_idx`(`runId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Command` (
    `id` VARCHAR(191) NOT NULL,
    `botId` VARCHAR(191) NULL,
    `accountId` VARCHAR(191) NULL,
    `type` ENUM('START', 'STOP', 'KILL', 'TEST_LOGIN') NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'DONE', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `result` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Command_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `diff` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Bot` ADD CONSTRAINT `Bot_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `TradingAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Bot` ADD CONSTRAINT `Bot_flowId_fkey` FOREIGN KEY (`flowId`) REFERENCES `Flow`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BotRun` ADD CONSTRAINT `BotRun_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `BotRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiPrediction` ADD CONSTRAINT `AiPrediction_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RunLog` ADD CONSTRAINT `RunLog_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `BotRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Command` ADD CONSTRAINT `Command_botId_fkey` FOREIGN KEY (`botId`) REFERENCES `Bot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
