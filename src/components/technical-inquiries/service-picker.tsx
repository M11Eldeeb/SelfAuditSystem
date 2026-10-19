"use client";

import { useState, type ReactNode } from "react";

/**
 * The workshop's "new request" box: first pick the service - a technical inquiry or a verification code - then the
 * matching form opens.
 */
export function ServicePicker({ inquiryForm, codeForm }: { inquiryForm: ReactNode; codeForm: ReactNode }) {
  const [service, setService] = useState<"inquiry" | "code" | null>(null);
  const option = (key: "inquiry" | "code", title: string, hint: string) => (
    <button
      type="button"
      onClick={() => setService(service === key ? null : key)}
      aria-pressed={service === key}
      className={`flex-1 rounded-xl px-4 py-3 text-left ring-1 transition-colors ${
        service === key ? "bg-brand/5 ring-2 ring-brand" : "bg-white ring-neutral-200 hover:bg-neutral-50"
      }`}
    >
      <div className="text-sm font-semibold text-neutral-900">{title}</div>
      <div className="text-xs text-neutral-500">{hint}</div>
    </button>
  );
  return (
    <section className="space-y-3 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-neutral-900">New request - choose the service</div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {option("inquiry", "Technical inquiry", "A workshop problem for the technical team")}
        {option("code", "Verification code", "VIN and mileage photos, module and reason")}
      </div>
      {service === "inquiry" && inquiryForm}
      {service === "code" && codeForm}
    </section>
  );
}
