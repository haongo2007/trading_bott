import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PageSkeleton } from "@/components/page-skeleton";
import { botToFormValues } from "@/lib/validation/bot";
import { getWorkerHealth } from "../../../accounts/worker-actions";
import { BotForm } from "../../bot-form";
import { updateBot } from "../../actions";
import { loadBotFormOptions } from "../../form-options";

export default function EditBotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const { id } = await params;
  const [bot, { accounts, flows }, health] = await Promise.all([
    prisma.bot.findUnique({ where: { id } }),
    loadBotFormOptions(),
    getWorkerHealth(),
  ]);
  if (!bot) notFound();
  return (
    <div className="space-y-6">
      <div>
        <div className="breadcrumbs text-sm">
          <ul>
            <li>
              <Link href="/bots">Bot</Link>
            </li>
            <li>
              <Link href={`/bots/${id}`}>{bot.name}</Link>
            </li>
            <li>Cài đặt</li>
          </ul>
        </div>
        <h1 className="text-2xl font-bold">Cài đặt bot: {bot.name}</h1>
      </div>
      <BotForm
        action={updateBot.bind(null, id)}
        initial={botToFormValues(bot)}
        accounts={accounts}
        flows={flows}
        aiConfigured={!health.online || health.aiConfigured !== false}
      />
    </div>
  );
}
