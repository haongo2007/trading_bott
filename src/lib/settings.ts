import { prisma } from "@/lib/prisma";

// Cài đặt hệ thống lưu trong bảng AppSetting (key → JSON).

export const NOTIFY_EVENTS = {
  BOT_START: "Bot bắt đầu chạy",
  BOT_STOP: "Bot dừng (chốt lời, cắt lỗ, đủ lệnh, dừng tay…)",
  BOT_ERROR: "Bot lỗi / không khởi động được",
  ORDER_UNCERTAIN: "Lệnh không rõ trạng thái (cần kiểm tra trên sàn)",
  LOGIN_FAILED: "Kiểm tra đăng nhập thất bại",
  DAILY_SUMMARY: "Tổng kết cuối ngày",
} as const;
export type NotifyEvent = keyof typeof NOTIFY_EVENTS;

export type TelegramSettings = {
  enabled: boolean;
  botTokenEnc?: string; // AES-256-GCM
  chatId?: string;
  events: NotifyEvent[];
  summaryTime?: string; // "HH:MM" — giờ gửi tổng kết ngày
  timezone: string;
};

export type StorageSettings = { retentionDays: number };

export type SchedulerState = { lastSummaryDate?: string; lastCleanupDate?: string };

export const DEFAULT_TELEGRAM: TelegramSettings = {
  enabled: false,
  events: ["BOT_STOP", "BOT_ERROR", "ORDER_UNCERTAIN", "LOGIN_FAILED", "DAILY_SUMMARY"],
  summaryTime: "23:00",
  timezone: "Asia/Ho_Chi_Minh",
};
export const DEFAULT_STORAGE: StorageSettings = { retentionDays: 14 };

type Settings = { telegram: TelegramSettings; storage: StorageSettings; schedulerState: SchedulerState };
const DEFAULTS: Settings = { telegram: DEFAULT_TELEGRAM, storage: DEFAULT_STORAGE, schedulerState: {} };

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return { ...DEFAULTS[key], ...((row?.value as object) ?? {}) } as Settings[K];
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
