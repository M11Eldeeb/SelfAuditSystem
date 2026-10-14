"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { CC_GROUP_LABELS, SAMPLE_PODIUM, composeMail, sampleVars, validateTemplate, type CcGroup, type MailDef, type ResolvedTemplate } from "@/lib/mail/catalog";
import { resetMailTemplate, saveMailTemplate } from "./actions";

const splitAddresses = (text: string) => text.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
const field =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none disabled:opacity-60";

/** Edit one mail: subject, message, who is copied, extra addresses and the reminder / deadline days - with a live preview. */
export function MailEditor({ def, saved, customized }: { def: MailDef; saved: ResolvedTemplate; customized: boolean }) {
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  const [ccGroups, setCcGroups] = useState<CcGroup[]>(saved.ccGroups);
  const [extraTo, setExtraTo] = useState(saved.extraTo.join(", "));
  const [extraCc, setExtraCc] = useState(saved.extraCc.join(", "));
  const [milestones, setMilestones] = useState(saved.milestones.join(", "));
  const [deadlineDays, setDeadlineDays] = useState(String(saved.deadlineDays));
  const [note, setNote] = useState<{ good: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(
    () => composeMail({ subject, body }, sampleVars(def), def.key === "podium" ? SAMPLE_PODIUM : undefined),
    [subject, body, def]
  );
  const problem = validateTemplate(def, subject, body);
  const dirty =
    subject !== saved.subject ||
    body !== saved.body ||
    ccGroups.slice().sort().join() !== saved.ccGroups.slice().sort().join() ||
    extraTo !== saved.extraTo.join(", ") ||
    extraCc !== saved.extraCc.join(", ") ||
    milestones !== saved.milestones.join(", ") ||
    deadlineDays !== String(saved.deadlineDays);

  function insert(name: string) {
    const el = bodyRef.current;
    const token = `{${name}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function save() {
    setNote(null);
    startTransition(async () => {
      const res = await saveMailTemplate({
        key: def.key,
        subject,
        body,
        ccGroups,
        extraTo: splitAddresses(extraTo),
        extraCc: splitAddresses(extraCc),
        milestones: def.milestones ? splitAddresses(milestones).map(Number).filter((n) => Number.isFinite(n)) : undefined,
        deadlineDays: def.deadlineDays ? Number(deadlineDays) : undefined,
      });
      setNote(res.error ? { good: false, text: res.error } : { good: true, text: "Saved. The next mail of this kind uses these changes." });
    });
  }

  function reset() {
    if (!window.confirm("Put this mail back to its original wording, copies and days?")) return;
    setNote(null);
    startTransition(async () => {
      const res = await resetMailTemplate(def.key);
      if (res.error) return setNote({ good: false, text: res.error });
      setSubject(def.defaultSubject);
      setBody(def.defaultBody);
      setCcGroups(def.defaultCc);
      setExtraTo("");
      setExtraCc("");
      setMilestones((def.milestones ?? []).join(", "));
      setDeadlineDays(String(def.deadlineDays ?? 15));
      setNote({ good: true, text: "Back to the original." });
    });
  }

  return (
    <div className="space-y-4 border-t border-neutral-100 pt-4">
      <div className="space-y-1.5">
        <label htmlFor={`subject-${def.key}`} className="text-xs font-medium text-neutral-700">
          Subject
        </label>
        <input id={`subject-${def.key}`} value={subject} onChange={(e) => setSubject(e.target.value)} className={field} disabled={pending} />
        {def.asReply && (
          <p className="text-xs text-neutral-500">When the first mail of this thread exists, this goes out as a reply, so its subject becomes &quot;Re: &quot; followed by that mail&apos;s subject. This subject is used only if there is none.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`body-${def.key}`} className="text-xs font-medium text-neutral-700">
          Message
        </label>
        <textarea
          id={`body-${def.key}`}
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          disabled={pending}
          className={`${field} font-mono text-[13px] leading-relaxed`}
        />
        <p className="text-xs text-neutral-500">
          Separate paragraphs with an empty line. A paragraph starting with <code>Note:</code> becomes a highlighted note, and a line like <code>Open the portal: {"{link}"}</code> becomes a button.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-neutral-500">Insert:</span>
          {def.placeholders.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => insert(p.name)}
              title={`${p.help} Example: ${p.sample || "(the podium)"}`}
              className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 font-mono text-xs text-neutral-700 transition-colors hover:border-brand hover:text-brand"
            >
              {`{${p.name}}`}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-neutral-700">Copied on this mail (Cc)</legend>
        <p className="text-xs text-neutral-500">To: {def.to}.</p>
        <p className="text-xs text-neutral-500">
          The Cc line always follows this order: the warranty head, then the extra addresses you type below (named people such as Ahmed Mahmod), then the service manager(s), then the officers, then the standing managers. A group that is not ticked is skipped and the next one moves up.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {(Object.keys(CC_GROUP_LABELS) as CcGroup[]).map((g) => (
            <label key={g} className="flex items-center gap-2 text-sm text-neutral-800">
              <input
                type="checkbox"
                checked={ccGroups.includes(g)}
                disabled={pending}
                onChange={(e) => setCcGroups((cur) => (e.target.checked ? [...cur, g] : cur.filter((x) => x !== g)))}
                className="h-4 w-4 rounded border-neutral-300 text-brand focus:ring-brand/30"
              />
              {CC_GROUP_LABELS[g]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={`xto-${def.key}`} className="text-xs font-medium text-neutral-700">
            Extra addresses in To <span className="font-normal text-neutral-500">(optional, separate with commas)</span>
          </label>
          <input id={`xto-${def.key}`} value={extraTo} onChange={(e) => setExtraTo(e.target.value)} className={field} disabled={pending} placeholder="name@jiadmotors.com" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`xcc-${def.key}`} className="text-xs font-medium text-neutral-700">
            Extra addresses in Cc <span className="font-normal text-neutral-500">(go right after the warranty head; separate with commas)</span>
          </label>
          <input id={`xcc-${def.key}`} value={extraCc} onChange={(e) => setExtraCc(e.target.value)} className={field} disabled={pending} placeholder="name@jiadmotors.com" />
        </div>
      </div>

      {(def.milestones || def.deadlineDays) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {def.milestones && (
            <div className="space-y-1.5">
              <label htmlFor={`ms-${def.key}`} className="text-xs font-medium text-neutral-700">
                Reminder days before the deadline <span className="font-normal text-neutral-500">(e.g. 7, 3, 1)</span>
              </label>
              <input id={`ms-${def.key}`} value={milestones} onChange={(e) => setMilestones(e.target.value)} className={field} disabled={pending} />
            </div>
          )}
          {def.deadlineDays && (
            <div className="space-y-1.5">
              <label htmlFor={`dd-${def.key}`} className="text-xs font-medium text-neutral-700">
                Days from the start of the cycle to the deadline
              </label>
              <input id={`dd-${def.key}`} type="number" min={1} max={90} value={deadlineDays} onChange={(e) => setDeadlineDays(e.target.value)} className={field} disabled={pending} />
            </div>
          )}
        </div>
      )}
      {def.attachment && <p className="text-xs text-neutral-500">{def.attachment}</p>}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-neutral-700">Preview (with sample numbers)</p>
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <p className="text-xs text-neutral-500">Subject</p>
          <p className="mb-2 font-medium text-neutral-900">{preview.subject}</p>
          <pre className="font-sans text-[13px] whitespace-pre-wrap text-neutral-800">{preview.text}</pre>
        </div>
      </div>

      {problem && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}
      {note && (
        <p role="status" className={`rounded-lg border px-3 py-2 text-sm ${note.good ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {note.text}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !!problem || !dirty}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
        {(customized || dirty) && (
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Reset to the original
          </button>
        )}
        {dirty && <span className="text-xs text-amber-700">Unsaved changes - &quot;Send me a sample&quot; uses the saved version.</span>}
      </div>
    </div>
  );
}
