import { Suspense } from "react";
import { Brain, HardDrive, MessageCircle, Server } from "lucide-react";
import { requireUser } from "@/auth";
import { getSetting, NOTIFY_EVENTS } from "@/lib/settings";
import { PageSkeleton } from "@/components/page-skeleton";
import { getWorkerHealth } from "../accounts/worker-actions";
import { StorageForm, TelegramForm } from "./settings-forms";

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const user = await requireUser();
  const readOnly = user.role !== "ADMIN";
  const [tg, storage, health] = await Promise.all([getSetting("telegram"), getSetting("storage"), getWorkerHealth()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt</h1>
        <p className="text-sm text-base-content/60">{readOnly ? "Chỉ ADMIN được thay đổi cài đặt." : "Thông báo, lưu trữ và trạng thái hệ thống."}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatusCard icon={<Server className="size-5" />} title="Worker" ok={health.online} text={health.online ? "Đang chạy" : "Không phản hồi — chạy npm run worker"} />
        <StatusCard
          icon={<Brain className="size-5" />}
          title="AI (Claude)"
          ok={!!health.aiConfigured}
          text={health.aiConfigured ? "Đã có thông tin xác thực" : health.online ? "Chưa đặt ANTHROPIC_API_KEY cho worker" : "Không rõ (worker tắt)"}
        />
        <StatusCard icon={<MessageCircle className="size-5" />} title="Telegram" ok={tg.enabled && !!tg.botTokenEnc && !!tg.chatId} text={tg.enabled ? "Đang bật" : "Đang tắt"} />
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body">
          <h2 className="card-title text-base">
            <MessageCircle className="size-5 text-primary" /> Thông báo Telegram
          </h2>
          <TelegramForm
            readOnly={readOnly}
            eventLabels={NOTIFY_EVENTS}
            initial={{
              enabled: tg.enabled,
              hasToken: !!tg.botTokenEnc,
              chatId: tg.chatId ?? "",
              events: tg.events,
              summaryTime: tg.summaryTime ?? "",
              timezone: tg.timezone,
            }}
          />
        </div>
      </div>

      <div className="card bg-base-100 shadow-sm">
        <div className="card-body">
          <h2 className="card-title text-base">
            <HardDrive className="size-5 text-primary" /> Lưu trữ
          </h2>
          <p className="text-sm text-base-content/60">Worker tự xoá ảnh chụp (chạy thử flow, lệnh bot, lỗi đăng nhập) cũ hơn số ngày này, mỗi ngày 1 lần.</p>
          <StorageForm retentionDays={storage.retentionDays} readOnly={readOnly} />
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon, title, ok, text }: { icon: React.ReactNode; title: string; ok: boolean; text: string }) {
  return (
    <div className="card bg-base-100 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`grid size-10 place-items-center rounded-field ${ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{icon}</div>
        <div>
          <div className="font-semibold">{title}</div>
          <div className="text-sm text-base-content/60">{text}</div>
        </div>
      </div>
    </div>
  );
}
