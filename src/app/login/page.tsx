import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-base-200 p-4">
      {/* nền trang trí */}
      <div className="pointer-events-none absolute -top-32 -left-32 size-96 rounded-full bg-primary/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 -bottom-32 size-96 rounded-full bg-secondary/20 blur-3xl" />
      <div className="relative w-full max-w-sm">
        <Suspense fallback={<LoginForm />}>
          {searchParams.then(({ callbackUrl }) => (
            <LoginForm callbackUrl={callbackUrl} />
          ))}
        </Suspense>
      </div>
    </main>
  );
}
