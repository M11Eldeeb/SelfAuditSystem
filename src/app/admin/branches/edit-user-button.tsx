"use client";

import { useActionState, useState } from "react";
import { updateUser } from "./actions";
import { BRANCH_ROLES, ROLE_OPTIONS, queueDefaultLabel } from "./roles";

type EditableUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  queue_role: string | null;
  branch_id: string | null;
  view_all: boolean | null;
  courtesy_access: boolean | null;
};

const field =
  "w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none";
const lbl = "block text-xs font-medium text-neutral-700";

/** Change an account's name, role, customer queue access, branch and view-all access after it was made. */
export function EditUserButton({
  user,
  branches,
  self,
}: {
  user: EditableUser;
  branches: { id: string; name: string }[];
  self: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(user.role);
  const [state, formAction, pending] = useActionState(updateUser, undefined);
  const needsBranch = BRANCH_ROLES.includes(role) || role === "queue_user";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-semibold text-neutral-700 hover:text-neutral-900"
      >
        Edit
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <form
            action={formAction}
            className="w-full max-w-sm space-y-2.5 rounded-2xl bg-white p-4 text-left shadow-2xl ring-1 ring-black/10"
          >
            <input type="hidden" name="user_id" value={user.id} />
            <h2 className="text-base font-bold text-neutral-900">
              Edit account
            </h2>
            <p className="truncate text-xs font-semibold text-neutral-500">
              {user.email}
            </p>
            <label className="block space-y-1">
              <span className={lbl}>Full name</span>
              <input
                name="full_name"
                defaultValue={user.full_name ?? ""}
                className={field}
              />
            </label>
            <label className="block space-y-1">
              <span className={lbl}>Role</span>
              <select
                name="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                disabled={self}
                className={field}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {self && <input type="hidden" name="role" value={role} />}
            </label>
            <label className="block space-y-1">
              <span className={lbl}>Customer queue</span>
              <select
                name="queue_role"
                defaultValue={user.queue_role ?? ""}
                required={role === "queue_user"}
                disabled={self}
                className={field}
              >
                <option value="">{queueDefaultLabel(role)}</option>
                <option value="advisor">Service advisor</option>
                <option value="parts_advisor">Spare parts advisor</option>
                <option value="manager">
                  Queue manager (reception manager)
                </option>
              </select>
              {self && (
                <input
                  type="hidden"
                  name="queue_role"
                  value={user.queue_role ?? ""}
                />
              )}
            </label>
            {needsBranch && (
              <label className="block space-y-1">
                <span className={lbl}>
                  Branch{role === "queue_user" ? " (head office: none)" : ""}
                </span>
                <select
                  name="branch_id"
                  defaultValue={user.branch_id ?? ""}
                  required={role !== "queue_user"}
                  className={field}
                >
                  <option value="">
                    {role === "queue_user"
                      ? "No branch (head office)"
                      : "Select branch"}
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {role !== "officer" && (
              <label className="flex items-start gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  name="view_all"
                  defaultChecked={!!user.view_all}
                  disabled={self}
                  className="mt-0.5 accent-[#c4121a]"
                />
                <span>
                  View all – may also open the warranty officer’s pages (read
                  only)
                </span>
                {self && user.view_all && (
                  <input type="hidden" name="view_all" value="on" />
                )}
              </label>
            )}
            {!["officer", "service_advisor", "queue_user", "branch_admin", "service_manager"].includes(role) && (
              <label className="flex items-start gap-2 text-xs text-neutral-700">
                <input
                  type="checkbox"
                  name="courtesy_access"
                  defaultChecked={!!user.courtesy_access}
                  className="mt-0.5 accent-[#c4121a]"
                />
                <span>
                  Courtesy cars – may hand cars over and take them back in his
                  branch (not shown to customers as a service advisor)
                </span>
              </label>
            )}
            {self && (
              <p className="text-xs text-neutral-500">
                Your own role and access can only be changed by another warranty
                officer.
              </p>
            )}
            {state?.error && (
              <p className="text-xs text-red-600">{state.error}</p>
            )}
            {state?.success && (
              <p className="text-xs text-emerald-600">{state.success}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
