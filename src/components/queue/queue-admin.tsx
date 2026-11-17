"use client";

import { useMemo, useState, useTransition } from "react";
import { importQueueAccounts, setQueueRole, updateBranchQueue, type ImportResult } from "@/app/actions/queue-admin";

export type AdminBranch = { id: string; name: string; queue_code: string | null; name_ar: string | null; queue_status: string; qrSvg: string | null; joinUrl: string | null };
export type AdminUser = { id: string; name: string; email: string; role: string; branch: string | null; queue_role: string | null; job_title: string | null };
export type AdminPerson = { id: string; name: string; title: string | null; branch: string | null; email: string | null; queue_role: string; account: "none" | "no_access" | "linked" };

const QUEUE_ROLES = [
  { value: "advisor", label: "Service advisor" },
  { value: "parts_advisor", label: "Parts advisor" },
  { value: "manager", label: "Queue manager" },
];
const roleLabel = (r: string | null) => QUEUE_ROLES.find((x) => x.value === r)?.label ?? "—";
const card = "rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/70";
const input = "h-9 rounded-lg border border-neutral-200 bg-white px-2 text-sm";

export function QueueAdmin({ branches, users, people }: { branches: AdminBranch[]; users: AdminUser[]; people: AdminPerson[] }) {
  return (
    <div className="space-y-6">
      <Branches branches={branches} />
      <Import people={people} />
      <Access users={users} />
    </div>
  );
}

function Branches({ branches }: { branches: AdminBranch[] }) {
  return (
    <section className={card}>
      <h2 className="font-semibold text-neutral-900">Branches</h2>
      <p className="mb-4 text-sm text-neutral-500">The queue code is in the branch&apos;s join and TV addresses (kept from the old app). Paused or closed: customers cannot join.</p>
      <div className="space-y-3">
        {branches.map((b) => (
          <BranchRow key={b.id} b={b} />
        ))}
      </div>
    </section>
  );
}

function BranchRow({ b }: { b: AdminBranch }) {
  const [code, setCode] = useState(b.queue_code ?? "");
  const [ar, setAr] = useState(b.name_ar ?? "");
  const [status, setStatus] = useState(b.queue_status);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 p-3">
      {b.qrSvg && b.joinUrl ? (
        <a href={b.joinUrl} target="_blank" rel="noreferrer" title="Join page - right-click the code to save it for printing" className="h-20 w-20 shrink-0 rounded bg-white p-1 ring-1 ring-neutral-200" dangerouslySetInnerHTML={{ __html: b.qrSvg }} />
      ) : (
        <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded bg-neutral-50 text-[10px] text-neutral-400">No code</span>
      )}
      <div className="min-w-[140px] flex-1">
        <div className="font-semibold text-neutral-900">{b.name}</div>
        {b.queue_code && (
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs font-medium">
            <a href={`/q/${b.queue_code}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              Join page ↗
            </a>
            <a href={`/q/display/${b.queue_code}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
              TV ↗
            </a>
          </div>
        )}
      </div>
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Queue code" className={`${input} w-40`} dir="ltr" />
      <input value={ar} onChange={(e) => setAr(e.target.value)} placeholder="Arabic name" className={`${input} w-48`} dir="rtl" />
      <select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
        <option value="open">Open</option>
        <option value="paused">Paused</option>
        <option value="closed">Closed</option>
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await updateBranchQueue(b.id, { queueCode: code, nameAr: ar, status });
            setMsg(r.error ? { text: r.error, bad: true } : { text: "Saved" });
          })
        }
        className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Save
      </button>
      {msg && <span className={`text-xs ${msg.bad ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
    </div>
  );
}

function Import({ people }: { people: AdminPerson[] }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState("");
  const [filter, setFilter] = useState<"todo" | "all">("todo");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);

  const shown = useMemo(() => people.filter((p) => filter === "all" || p.account !== "linked"), [people, filter]);
  const todo = people.filter((p) => p.account !== "linked").length;
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const needsPassword = [...picked].some((id) => people.find((p) => p.id === id)?.account === "none");

  function run() {
    setError(null);
    start(async () => {
      const ids = [...picked];
      const all: ImportResult[] = [];
      for (let i = 0; i < ids.length; i += 25) {
        setProgress(`${Math.min(i + 25, ids.length)} / ${ids.length}`);
        const r = await importQueueAccounts(ids.slice(i, i + 25), password);
        if (r.error) {
          setError(r.error);
          break;
        }
        all.push(...r.results);
      }
      setProgress(null);
      setResults(all);
      setPicked(new Set());
    });
  }

  return (
    <section className={card}>
      <h2 className="font-semibold text-neutral-900">Queue people from the old app</h2>
      <p className="mb-3 text-sm text-neutral-500">
        Someone with a portal account (same e-mail) gets queue access on it. Anyone else gets a queue-only account with the first password you type here; they choose their own at the first sign-in. {todo} still to do.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value as "todo" | "all")} className={input}>
          <option value="todo">Still to do</option>
          <option value="all">Everyone</option>
        </select>
        <button type="button" onClick={() => setPicked(new Set(shown.filter((p) => p.account !== "linked").map((p) => p.id)))} className="text-sm font-semibold text-brand hover:underline">
          Tick all shown
        </button>
        {picked.size > 0 && (
          <button type="button" onClick={() => setPicked(new Set())} className="text-sm text-neutral-500 hover:underline">
            Clear
          </button>
        )}
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded-xl border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-2 py-2 text-start font-medium">Name</th>
              <th className="px-2 py-2 text-start font-medium">Queue role</th>
              <th className="px-2 py-2 text-start font-medium">Branch</th>
              <th className="px-2 py-2 text-start font-medium">E-mail</th>
              <th className="px-2 py-2 text-start font-medium">Account</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((p) => (
              <tr key={p.id} className={picked.has(p.id) ? "bg-brand/5" : ""}>
                <td className="px-2 py-1.5 text-center">
                  <input type="checkbox" disabled={p.account === "linked"} checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="accent-brand" />
                </td>
                <td className="px-2 py-1.5">
                  <div className="font-medium text-neutral-900">{p.name}</div>
                  {p.title && <div className="text-xs text-neutral-500">{p.title}</div>}
                </td>
                <td className="px-2 py-1.5 text-neutral-700">{roleLabel(p.queue_role)}</td>
                <td className="px-2 py-1.5 text-neutral-600">{p.branch ?? "Head office"}</td>
                <td className="px-2 py-1.5 text-neutral-600" dir="ltr">
                  {p.email ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {p.account === "linked" ? (
                    <span className="text-emerald-700">✓ Has queue access</span>
                  ) : p.account === "no_access" ? (
                    <span className="text-amber-700">Has an account - queue access to add</span>
                  ) : (
                    <span className="text-neutral-500">No account</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {needsPassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="First password (8+ characters)"
            autoComplete="new-password"
            className={`${input} w-64`}
          />
        )}
        <button
          type="button"
          disabled={pending || picked.size === 0 || (needsPassword && password.length < 8)}
          onClick={run}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? `Working… ${progress ?? ""}` : `Create / link ${picked.size || ""}`}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
      {results.length > 0 && (
        <div className="mt-3 rounded-xl bg-neutral-50 p-3 text-sm">
          <p className="font-medium text-neutral-900">
            {results.filter((r) => r.outcome === "created").length} created · {results.filter((r) => r.outcome === "linked").length} linked · {results.filter((r) => r.outcome === "error").length} not done
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {results
              .filter((r) => r.outcome === "error")
              .map((r) => (
                <li key={r.employeeId} className="text-red-700">
                  {r.name}: {r.message}
                </li>
              ))}
          </ul>
          <p className="mt-1 text-xs text-neutral-500">Reload the page to see the updated list.</p>
        </div>
      )}
    </section>
  );
}

function Access({ users }: { users: AdminUser[] }) {
  const [q, setQ] = useState("");
  const [onlyQueue, setOnlyQueue] = useState(true);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return users.filter((u) => (!onlyQueue || u.queue_role) && (!n || `${u.name} ${u.email} ${u.branch ?? ""}`.toLowerCase().includes(n)));
  }, [users, q, onlyQueue]);
  return (
    <section className={card}>
      <h2 className="font-semibold text-neutral-900">Queue access</h2>
      <p className="mb-3 text-sm text-neutral-500">
        What each account does in the queue, beside its portal role. Warranty officers, national managers and managers see every branch already. A queue manager without a branch sees every branch.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, e-mail, branch" className={`${input} w-64`} />
        <label className="flex items-center gap-1.5 text-sm text-neutral-700">
          <input type="checkbox" checked={onlyQueue} onChange={(e) => setOnlyQueue(e.target.checked)} className="accent-brand" /> Only accounts with queue access
        </label>
        <span className="text-xs text-neutral-500">{shown.length} accounts</span>
      </div>
      <div className="max-h-[480px] overflow-y-auto rounded-xl border border-neutral-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-neutral-50 text-xs text-neutral-500">
            <tr>
              <th className="px-2 py-2 text-start font-medium">Account</th>
              <th className="px-2 py-2 text-start font-medium">Branch</th>
              <th className="px-2 py-2 text-start font-medium">Queue role</th>
              <th className="px-2 py-2 text-start font-medium">Job title</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {shown.map((u) => (
              <AccessRow key={u.id} u={u} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccessRow({ u }: { u: AdminUser }) {
  const [role, setRole] = useState(u.queue_role ?? "");
  const [title, setTitle] = useState(u.job_title ?? "");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [pending, start] = useTransition();
  const changed = role !== (u.queue_role ?? "") || title !== (u.job_title ?? "");
  return (
    <tr>
      <td className="px-2 py-1.5">
        <div className="font-medium text-neutral-900">{u.name}</div>
        <div className="text-xs text-neutral-500" dir="ltr">
          {u.email}
        </div>
      </td>
      <td className="px-2 py-1.5 text-neutral-600">{u.branch ?? "—"}</td>
      <td className="px-2 py-1.5">
        <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
          <option value="">No queue access</option>
          {QUEUE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={`${input} w-44`} />
      </td>
      <td className="whitespace-nowrap px-2 py-1.5">
        {changed && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await setQueueRole(u.id, role || null, title);
                setMsg(r.error ? { text: r.error, bad: true } : { text: "Saved" });
              })
            }
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Save
          </button>
        )}
        {msg && <span className={`ms-2 text-xs ${msg.bad ? "text-red-600" : "text-emerald-700"}`}>{msg.text}</span>}
      </td>
    </tr>
  );
}
