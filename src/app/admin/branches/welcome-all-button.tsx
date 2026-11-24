"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendWelcomeToAllNew } from "./actions";

type Result = Awaited<ReturnType<typeof sendWelcomeToAllNew>>;

/** Sends the welcome e-mail to every new service advisor / reception account that has not had it (never signed in). */
export function WelcomeAllButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  if (!count && !result) return null;
  return (
    <div className="space-y-2 rounded-xl border border-brand/20 bg-brand/[0.04] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-neutral-800">
          <b>{count}</b> new service advisor / reception account{count === 1 ? "" : "s"} without the welcome e-mail (never signed in).
        </p>
        {count > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!window.confirm(`Send the welcome e-mail to ${count} account${count === 1 ? "" : "s"}? Each gets a new temporary password in it (an older one stops working).`)) return;
              start(async () => {
                setResult(await sendWelcomeToAllNew());
                router.refresh();
              });
            }}
            className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50"
          >
            {pending ? "Sending…" : `Send welcome e-mail to all ${count}`}
          </button>
        )}
      </div>
      {result?.error && <p className="text-red-600">{result.error}</p>}
      {result && !result.error && (
        <div className="space-y-1">
          {result.sent.length > 0 && <p className="text-emerald-700">Sent to {result.sent.length}: {result.sent.join(", ")}</p>}
          {result.failed.map((f) => (
            <p key={f.email} className="text-red-600">
              {f.email}: {f.error}
              {f.tempPassword && (
                <>
                  {" "}
                  – give this password by hand: <code className="rounded bg-red-50 px-1">{f.tempPassword}</code>
                </>
              )}
            </p>
          ))}
          {result.left > 0 && <p className="text-neutral-600">{result.left} more – press the button again.</p>}
        </div>
      )}
    </div>
  );
}
