import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const httpUrl = z.url({ protocol: /^https?$/, error: "URL không hợp lệ (http/https)" });

export const accountSchema = z
  .object({
    name: z.string().trim().min(1, "Bắt buộc").max(100),
    platformName: z.string().trim().min(1, "Bắt buộc").max(100),
    loginUrl: httpUrl,
    tradeUrl: httpUrl,
    username: z.string().trim().max(255),
    password: z.string().max(255).optional().transform((v) => (v ? v : null)),
    loginMethod: z.enum(["FORM", "SESSION", "NONE"]),
    usernameSelector: optionalText(1024),
    passwordSelector: optionalText(1024),
    submitSelector: optionalText(1024),
    successSelector: optionalText(1024),
    balanceSelector: optionalText(1024),
    currency: z.string().trim().min(1).max(10),
    viewportWidth: z.coerce.number().int().min(320).max(3840),
    viewportHeight: z.coerce.number().int().min(320).max(2160),
    locale: z.string().trim().min(2).max(20),
    timezone: z.string().trim().min(1).max(64),
    loginTimeoutSec: z.coerce.number().int().min(5).max(180),
    maxLoginRetries: z.coerce.number().int().min(0).max(5),
    notes: optionalText(2000),
    disabled: z.preprocess((v) => v === "on" || v === true, z.boolean()),
  })
  .superRefine((data, ctx) => {
    if (data.loginMethod !== "NONE" && !data.username) {
      ctx.addIssue({ code: "custom", path: ["username"], message: "Bắt buộc" });
    }
    if (data.loginMethod === "FORM") {
      for (const key of ["usernameSelector", "passwordSelector", "submitSelector"] as const) {
        if (!data[key]) ctx.addIssue({ code: "custom", path: [key], message: "Bắt buộc khi đăng nhập bằng form" });
      }
    }
    if (data.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
      } catch {
        ctx.addIssue({ code: "custom", path: ["timezone"], message: "Múi giờ không hợp lệ" });
      }
    }
  });

export type AccountInput = z.infer<typeof accountSchema>;

export const accountStatusMeta = {
  UNVERIFIED: { text: "Chưa kiểm tra", badge: "badge-neutral" },
  ACTIVE: { text: "Hoạt động", badge: "badge-success" },
  LOGIN_FAILED: { text: "Lỗi đăng nhập", badge: "badge-error" },
  DISABLED: { text: "Tạm khoá", badge: "badge-warning" },
} as const;

export type AccountFormState = {
  errors?: Partial<Record<keyof AccountInput | "_form", string[]>>;
  message?: string;
};
