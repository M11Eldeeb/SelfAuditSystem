"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavIcon } from "@/components/nav-icons";
import { addFolder, buildRows, deleteFolder, moveRows, renameFolder, toLayout, type DragItem, type DropTarget, type MenuRow, type NavLayout } from "@/lib/nav-layout";

export type NavLink = {
  href: string;
  label: string;
  /** Other path prefixes that also belong to this tab. */
  match?: string[];
  /** Small tag after the label, e.g. "Soon" for a tab that is not open yet. */
  badge?: string;
  /** Tabs with the same group name fold under one heading (shown where the first of them is). */
  group?: string;
  /** Shown at the bottom of the sidebar, just above the user name. */
  bottom?: boolean;
  /** The name shown in the top bar for this page when it differs from the (short) menu label. */
  title?: string;
  /** Another website, opened in a new tab (not a page of this portal). */
  external?: boolean;
};

const GROUPS_KEY = "sidebar-groups-open";

/** Which folders are open: kept in this browser; a folder holding the current page opens by itself. */
function useOpenGroups(activeGroup: string | undefined) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  // The folders left open last time come back after the first paint (the server cannot know them).
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]") as string[];
        if (saved.length) setOpen((cur) => new Set([...cur, ...saved]));
      } catch {
        // nothing saved
      }
    });
  }, []);
  const [lastActive, setLastActive] = useState(activeGroup);
  if (activeGroup !== lastActive) {
    setLastActive(activeGroup);
    if (activeGroup && !open.has(activeGroup)) setOpen(new Set([...open, activeGroup]));
  }
  const toggle = (g: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // private window: lasts for this page only
      }
      return next;
    });
  const openIt = (g: string) => setOpen((cur) => (cur.has(g) ? cur : new Set([...cur, g])));
  return { open, toggle, openIt };
}

function Grip() {
  return (
    <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true" className="shrink-0 text-neutral-300">
      <circle cx="3.5" cy="3" r="1.3" />
      <circle cx="8.5" cy="3" r="1.3" />
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8.5" cy="8" r="1.3" />
      <circle cx="3.5" cy="13" r="1.3" />
      <circle cx="8.5" cy="13" r="1.3" />
    </svg>
  );
}

/**
 * The menu entries. With `onLayoutChange` and `organize` on, the entries and folders can be dragged: into the order the
 * person likes, into folders (their own, or the built-in ones), and out again. The result is handed to `onLayoutChange`.
 */
export function NavList({
  links,
  activeHref,
  animateIn,
  layout = null,
  organize = false,
  onLayoutChange,
}: {
  links: NavLink[];
  activeHref?: string;
  animateIn?: boolean | null;
  layout?: NavLayout | null;
  organize?: boolean;
  onLayoutChange?: (layout: NavLayout | null) => void;
}) {
  const rows = useMemo(() => buildRows(links, layout), [links, layout]);
  const activeGroup = rows.find((r) => r.kind === "folder" && r.links.some((l) => l.href === activeHref));
  const { open, toggle, openIt } = useOpenGroups(activeGroup?.kind === "folder" ? activeGroup.open : undefined);
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const canArrange = organize && !!onLayoutChange;

  const commit = (next: MenuRow<NavLink>[]) => onLayoutChange?.(toLayout(next));
  const drop = (target: DropTarget) => {
    if (!drag) return;
    const next = moveRows(rows, drag, target);
    if (next !== rows) {
      commit(next);
      if (drag.type === "link" && target.type === "folder") {
        const f = rows.find((r) => r.key === target.key);
        if (f?.kind === "folder") openIt(f.open);
      }
    }
    setDrag(null);
    setOver(null);
  };
  const dragProps = (item: DragItem) =>
    canArrange
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", item.key);
            setDrag(item);
          },
          onDragEnd: () => {
            setDrag(null);
            setOver(null);
          },
        }
      : {};
  const dropProps = (target: DropTarget) =>
    canArrange
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!drag || drag.key === target.key) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            setOver(target.key ?? "top-end");
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            drop(target);
          },
        }
      : {};
  const ring = (key: string) => (canArrange && over === key ? "rounded-xl ring-2 ring-brand/40" : "");
  const dim = (key: string) => (drag?.key === key ? "opacity-40" : "");

  const anim = (i: number) => ({
    style: animateIn == null ? undefined : { transitionDelay: animateIn ? `${60 + i * 25}ms` : "0ms" },
    className: animateIn == null ? "" : `transition-all duration-300 ease-out motion-reduce:transition-none ${animateIn ? "translate-x-0 opacity-100" : "-translate-x-2 opacity-0"}`,
  });

  const link = (l: NavLink, compact: boolean) => (
    <div className="flex items-center gap-1">
      {canArrange && <Grip />}
      <div className="min-w-0 flex-1">
        <NavRow link={l} active={l.href === activeHref} compact={compact} organize={canArrange} />
      </div>
    </div>
  );

  return (
    <ul className="space-y-1">
      {rows.map((row, i) =>
        row.kind === "link" ? (
          <li key={row.key} {...anim(i)} {...dragProps({ type: "link", key: row.key })} {...dropProps({ type: "link", key: row.key })} className={`${anim(i).className} ${ring(row.key)} ${dim(row.key)}`}>
            {link(row.link, false)}
          </li>
        ) : (
          <li key={row.key} {...anim(i)} {...dragProps({ type: "folder", key: row.key })} className={`${anim(i).className} ${dim(row.key)}`}>
            <div className={`flex items-center gap-1 ${ring(row.key)}`} {...dropProps({ type: "folder", key: row.key })}>
              {canArrange && <Grip />}
              {editing === row.key ? (
                <FolderNameInput
                  initial={row.name}
                  onDone={(name) => {
                    if (name) commit(renameFolder(rows, row.key, name));
                    setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => (canArrange ? undefined : toggle(row.open))}
                  aria-expanded={canArrange || open.has(row.open)}
                  className={`flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left text-[15px] leading-snug transition-colors hover:bg-neutral-900/[0.04] ${
                    activeGroup === row && !open.has(row.open) && !canArrange ? "bg-neutral-900/[0.07] font-semibold text-neutral-900" : "font-medium text-neutral-700"
                  }`}
                >
                  <span className="text-brand">
                    <NavIcon href={row.custom ? "#folder" : "#group"} label={row.name} size={20} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {!canArrange && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={`shrink-0 text-neutral-400 transition-transform duration-200 ${open.has(row.open) ? "rotate-90" : ""}`}>
                      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )}
              {canArrange && row.custom && editing !== row.key && (
                <>
                  <button type="button" onClick={() => setEditing(row.key)} aria-label={`Rename ${row.name}`} title="Rename" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-900/[0.05] hover:text-neutral-800">
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12.5 4.5l3 3M4 16l.7-3L13.5 4.2a1.4 1.4 0 012 0l.3.3a1.4 1.4 0 010 2L7 15.3z" />
                    </svg>
                  </button>
                  <button type="button" onClick={() => commit(deleteFolder(rows, row.key))} aria-label={`Delete ${row.name}`} title="Delete folder (its entries move back to the menu)" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-red-50 hover:text-red-700">
                    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.6 9.5h6.8L14 6" />
                    </svg>
                  </button>
                </>
              )}
            </div>
            {/* Always mounted so it can slide open and shut (grid rows 0fr <-> 1fr); the tabs fade in one after another. While arranging, every folder is open. */}
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${canArrange || open.has(row.open) ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
              inert={!(canArrange || open.has(row.open))}
            >
              <div className="overflow-hidden">
                <ul className="mt-1 ml-[1.35rem] space-y-0.5 border-l border-neutral-900/[0.08] pl-2">
                  {row.links.length === 0 && canArrange && <li className="px-2.5 py-1.5 text-[13px] text-neutral-400">Drop entries here</li>}
                  {row.links.map((l, j) => (
                    <li
                      key={l.href}
                      {...dragProps({ type: "link", key: l.href })}
                      {...dropProps({ type: "link", key: l.href })}
                      style={{ transitionDelay: open.has(row.open) ? `${40 + j * 30}ms` : "0ms" }}
                      className={`transition-all duration-300 ease-out motion-reduce:transition-none ${canArrange || open.has(row.open) ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"} ${ring(l.href)} ${dim(l.href)}`}
                    >
                      {link(l, true)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        )
      )}
      {canArrange && (
        <li className="space-y-1 pt-1">
          <div
            {...dropProps({ type: "top-end" })}
            className={`rounded-xl border border-dashed px-3 py-2 text-center text-[12px] text-neutral-400 ${over === "top-end" ? "border-brand/50 bg-brand/5" : "border-neutral-300"}`}
          >
            Drop here to take an entry out of a folder
          </div>
          <button
            type="button"
            onClick={() => {
              const added = addFolder(rows);
              commit(added.rows);
              setEditing(`folder:${added.id}`);
            }}
            className="flex min-h-9 w-full items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[14px] font-medium text-neutral-600 hover:bg-neutral-900/[0.04] hover:text-neutral-900"
          >
            <span aria-hidden="true" className="text-brand">+</span> New folder
          </button>
        </li>
      )}
    </ul>
  );
}

function FolderNameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  // Enter or Escape, then the blur that follows when the box goes away: only the first counts.
  const finished = useRef(false);
  const finish = (v: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(v);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      maxLength={30}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      aria-label="Folder name"
      className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-2.5 text-[14px] text-neutral-900 focus:border-brand focus:ring-2 focus:ring-brand/15 focus:outline-none"
    />
  );
}

function NavRow({ link, active, compact = false, organize = false }: { link: NavLink; active: boolean; compact?: boolean; organize?: boolean }) {
  const className = `flex ${compact ? "min-h-9 gap-2.5 px-2.5 py-1.5 text-[14px]" : "min-h-10 gap-3 px-3 py-2 text-[15px]"} items-center rounded-xl leading-snug transition-colors ${
    active ? "bg-neutral-900/[0.07] font-semibold text-neutral-900" : "font-medium text-neutral-700 hover:bg-neutral-900/[0.04] hover:text-neutral-900"
  } ${organize ? "cursor-grab" : ""}`;
  const content = (
    <>
      <span className="text-brand">
        <NavIcon href={link.href} label={link.label} size={compact ? 18 : 20} />
      </span>
      <span className="min-w-0 flex-1">{link.label}</span>
      {link.badge && <span className="shrink-0 rounded-full bg-neutral-900/[0.07] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-neutral-600">{link.badge}</span>}
      {link.external && (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-neutral-400">
          <path d="M9 3h4v4M13 3L7.5 8.5M12 9.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1h2.5" />
        </svg>
      )}
    </>
  );
  // While arranging, a click does not open the page.
  const stopWhenArranging = organize ? { onClick: (e: React.MouseEvent) => e.preventDefault() } : {};
  // An outside site (AMS) opens in its own tab; it is not a page of this portal.
  return link.external ? (
    <a href={link.href} target="_blank" rel="noopener noreferrer" title={`${link.label} - opens in a new tab`} className={className} {...stopWhenArranging}>
      {content}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  ) : (
    <Link href={link.href} aria-current={active ? "page" : undefined} className={className} {...stopWhenArranging}>
      {content}
    </Link>
  );
}
