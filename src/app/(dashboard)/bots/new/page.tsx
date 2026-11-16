import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/auth";
import { PageSkeleton } from "@/components/page-skeleton";
import { DEFAULT_BOT_VALUES } from "@/lib/validation/bot";
import { getWorkerHealth } from "../../accounts/worker-actions";
import { BotForm } from "../bot-form";
import { createBot } from "../actions";
import { loadBotFormOptions } from "../form-options";

export default function NewBotPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requireUser(["ADMIN", "OPERATOR"]);
  const [{ accounts, flows }, health] = await Promise.all([loadBotFormOptions(), getWorkerHealth()]);
  return (
    <div className="space-y-6">
      <div>
        <div className="breadcrumbs text-sm">
          <ul>
            <li>
              <Link href="/bots">Bot</Link>
            </li>
            <li>Tạo mới</li>
          </ul>
        </div>
        <h1 className="text-2xl font-bold">Tạo bot</h1>
      </div>
      <BotForm
        action={createBot}
        initial={{ ...DEFAULT_BOT_VALUES, accountId: accounts[0]?.id ?? "", flowId: flows.find((f) => !f.warn)?.id ?? "" }}
        accounts={accounts}
        flows={flows}
        aiConfigured={!health.online || health.aiConfigured !== false}
      />
    </div>
  );
}
