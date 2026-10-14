"use client";

import { useState, useTransition } from "react";
import { saveMailList } from "./actions";

type ListKey = "warranty_head" | "standing_managers";

const field =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-[13px] leading-relaxed text-neutral-900 shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

function ListEditor({ listKey, title, help, initial }: { listKey: ListKey; title: string; help: string; initial: string[] }) {
  const [text, setText] = useState(initial.join("\n"));
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = text.trim() !== initial.join("\n").trim();

  return (
    <div className="space-y-2 rounded-xl border border-neutral-200/70 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-500">{help}</p>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.max(3, Math.min(10, text.split("\n").length + 1))} className={field} disabled={pending} aria-label={title} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () => {
              setNote(null);
              const res = await saveMailList(listKey, text.split(/[\s,;]+/).filter(Boolean));
              setNote(res.error ? { good: false, text: res.error } : { good: true, text: "Saved." });
            })
          }
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        {note && <span className={`text-sm ${note.good ? "text-emerald-700" : "text-red-600"}`}>{note.text}</span>}
      </div>
    </div>
  );
}

/** The two standing contact lists the mails can copy: the warranty head, and the managers copied on the podium mail. One address per line. */
export function ContactLists({ head, standing }: { head: string[]; standing: string[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <ListEditor listKey="warranty_head" title="The warranty head" help='Used by the "The warranty head" copy option of every mail. One address per line.' initial={head} />
      <ListEditor listKey="standing_managers" title="The standing managers" help='Used by the "The standing managers list" copy option (the podium mail). One address per line.' initial={standing} />
    </div>
  );
}
