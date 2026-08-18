"use client";

import { useActionState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SkippedRow } from "@/lib/parse-claims";

type UploadState =
  | { error?: string; success?: string; inserted?: number; skipped?: SkippedRow[] }
  | undefined;

async function uploadClaims(_prev: UploadState, formData: FormData): Promise<UploadState> {
  try {
    const res = await fetch("/api/claims/upload", { method: "POST", body: formData });
    return await res.json();
  } catch {
    return { error: "Upload failed - check your connection and try again." };
  }
}

function defaultClaimMonth(): string {
  const now = new Date();
  now.setMonth(now.getMonth() - 1); // claims uploaded in Aug are usually July's claims
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadClaims, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state?.success, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="claim_month" className="text-xs font-medium text-neutral-700">
            Claims month
          </label>
          <input
            id="claim_month"
            name="claim_month"
            type="month"
            required
            defaultValue={defaultClaimMonth()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="file" className="text-xs font-medium text-neutral-700">
            Claims file (.xlsx or .csv)
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".xlsx,.csv"
            required
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1 file:text-xs file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Uploading..." : "Upload"}
        </button>
      </div>

      <p className="text-xs text-neutral-500">
        Expected columns (any order, header names are flexible): Branch, Claim Number, VIN,
        Vehicle Model, Mileage, Part Serial Number, Part Production Date, Repair End Date, Dealer
        Submit Date, Creation Date. Branch, Claim Number, and Creation Date are required.
      </p>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-emerald-600">{state.success}</p>}

      {state?.skipped && state.skipped.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p className="font-medium">{state.skipped.length} row(s) skipped:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {state.skipped.slice(0, 15).map((s, i) => (
              <li key={i}>
                Row {s.row}: {s.reason}
              </li>
            ))}
          </ul>
          {state.skipped.length > 15 && (
            <p className="mt-1">and {state.skipped.length - 15} more.</p>
          )}
        </div>
      )}
    </form>
  );
}
