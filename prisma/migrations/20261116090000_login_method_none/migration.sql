-- AlterTable: thêm phương thức "Không cần đăng nhập" (tài khoản sandbox / trang công khai)
ALTER TABLE `TradingAccount` MODIFY `loginMethod` ENUM('FORM', 'SESSION', 'NONE') NOT NULL DEFAULT 'FORM';
