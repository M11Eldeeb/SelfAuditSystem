/**
 * The menu layout each account can arrange by dragging: the order of the entries and folders the person made (or the
 * built-in folders such as "Dashboards"). Pure functions - the menu component only draws what they return.
 */

export type NavLayout = {
  /** Folders the person created. */
  folders: { id: string; name: string }[];
  /** Top-level rows in order: an entry's address, "folder:<id>" (own folder) or "group:<name>" (built-in folder). */
  top: string[];
  /** The entries inside each folder, in order (key: "folder:<id>" or "group:<name>"). */
  inside: Record<string, string[]>;
};

type Linkish = { href: string; group?: string };

export type MenuRow<L extends Linkish> =
  | { kind: "link"; key: string; link: L }
  | { kind: "folder"; key: string; /** The name that keeps the folder open or shut (built-in folders: their name, as before). */ open: string; name: string; id?: string; custom: boolean; links: L[] };

export type DragItem = { type: "link" | "folder"; key: string };
export type DropTarget = { type: "link" | "folder" | "top-end"; key?: string };

const groupKey = (name: string) => `group:${name}`;
const folderKey = (id: string) => `folder:${id}`;

/** The rows of the menu: the saved layout (if any) laid over the entries the page offers. */
export function buildRows<L extends Linkish>(links: L[], layout: NavLayout | null): MenuRow<L>[] {
  const byHref = new Map(links.map((l) => [l.href, l]));
  const custom = new Map((layout?.folders ?? []).map((f) => [folderKey(f.id), f]));
  const rows: MenuRow<L>[] = [];
  const folderRows = new Map<string, Extract<MenuRow<L>, { kind: "folder" }>>();
  const seen = new Set<string>();

  const folder = (key: string): Extract<MenuRow<L>, { kind: "folder" }> | null => {
    const had = folderRows.get(key);
    if (had) return had;
    let row: Extract<MenuRow<L>, { kind: "folder" }>;
    if (key.startsWith("folder:")) {
      const f = custom.get(key);
      if (!f) return null;
      row = { kind: "folder", key, open: key, name: f.name, id: f.id, custom: true, links: [] };
    } else if (key.startsWith("group:")) {
      const name = key.slice("group:".length);
      row = { kind: "folder", key, open: name, name, custom: false, links: [] };
    } else return null;
    folderRows.set(key, row);
    return row;
  };

  // 1. The saved layout.
  for (const key of layout?.top ?? []) {
    if (byHref.has(key)) {
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ kind: "link", key, link: byHref.get(key)! });
      }
    } else {
      const f = folder(key);
      if (f && !rows.includes(f)) rows.push(f);
    }
  }
  for (const [key, hrefs] of Object.entries(layout?.inside ?? {})) {
    const f = folder(key);
    if (!f) continue;
    if (!rows.includes(f)) rows.push(f);
    for (const href of hrefs) {
      const l = byHref.get(href);
      if (l && !seen.has(href)) {
        seen.add(href);
        f.links.push(l);
      }
    }
  }
  // 2. Entries the layout does not know (a new menu entry): where the page puts them.
  for (const l of links) {
    if (seen.has(l.href)) continue;
    seen.add(l.href);
    if (l.group) {
      const f = folder(groupKey(l.group));
      if (f) {
        if (!rows.includes(f)) rows.push(f);
        f.links.push(l);
        continue;
      }
    }
    rows.push({ kind: "link", key: l.href, link: l });
  }
  // A built-in folder with nothing left in it is not shown (an own folder stays, so things can be dropped in).
  return rows.filter((r) => r.kind === "link" || r.custom || r.links.length > 0);
}

/** The layout that draws exactly these rows. */
export function toLayout<L extends Linkish>(rows: MenuRow<L>[]): NavLayout {
  const folders: NavLayout["folders"] = [];
  const inside: NavLayout["inside"] = {};
  for (const r of rows) {
    if (r.kind !== "folder") continue;
    if (r.custom && r.id) folders.push({ id: r.id, name: r.name });
    inside[r.key] = r.links.map((l) => l.href);
  }
  return { folders, top: rows.map((r) => r.key), inside };
}

function cloneRows<L extends Linkish>(rows: MenuRow<L>[]): MenuRow<L>[] {
  return rows.map((r) => (r.kind === "folder" ? { ...r, links: [...r.links] } : r));
}

/**
 * Drops `drag` on `target`: an entry onto another entry (it takes that place, in the same folder or at the top), onto a
 * folder (it goes inside), or onto the end of the list (it leaves its folder); a folder onto another row (it takes that place).
 */
export function moveRows<L extends Linkish>(rows: MenuRow<L>[], drag: DragItem, target: DropTarget): MenuRow<L>[] {
  if (drag.key === target.key) return rows;
  const rs = cloneRows(rows);
  const topIndexOf = (key: string) => rs.findIndex((r) => r.key === key);
  const folderOfLink = (href: string) => rs.find((r): r is Extract<MenuRow<L>, { kind: "folder" }> => r.kind === "folder" && r.links.some((l) => l.href === href));

  if (drag.type === "folder") {
    const from = topIndexOf(drag.key);
    if (from < 0) return rows;
    let to = rs.length;
    if (target.type === "folder" && target.key) to = topIndexOf(target.key);
    else if (target.type === "link" && target.key) {
      const inFolder = folderOfLink(target.key);
      to = inFolder ? topIndexOf(inFolder.key) : topIndexOf(target.key);
    }
    if (to < 0) return rows;
    const [item] = rs.splice(from, 1);
    rs.splice(Math.min(to, rs.length), 0, item);
    return rs;
  }

  // An entry. Where does it come from?
  const fromFolder = folderOfLink(drag.key);
  const fromTop = topIndexOf(drag.key);
  const link = fromFolder ? fromFolder.links.find((l) => l.href === drag.key) : fromTop >= 0 && rs[fromTop].kind === "link" ? (rs[fromTop] as Extract<MenuRow<L>, { kind: "link" }>).link : undefined;
  if (!link) return rows;
  const row: MenuRow<L> = { kind: "link", key: drag.key, link };

  // Where does it go? (The index is taken before it is lifted out: moving down lands after the target, up before it.)
  if (target.type === "folder" && target.key) {
    const dest = rs.find((r): r is Extract<MenuRow<L>, { kind: "folder" }> => r.kind === "folder" && r.key === target.key);
    if (!dest) return rows;
    lift();
    dest.links.push(link);
    return rs;
  }
  if (target.type === "link" && target.key) {
    const destFolder = folderOfLink(target.key);
    if (destFolder) {
      const at = destFolder.links.findIndex((l) => l.href === target.key);
      lift();
      destFolder.links.splice(at, 0, link);
      return rs;
    }
    const at = topIndexOf(target.key);
    if (at < 0) return rows;
    lift();
    rs.splice(at, 0, row);
    return rs;
  }
  lift();
  rs.push(row);
  return rs;

  function lift() {
    if (fromFolder) fromFolder.links = fromFolder.links.filter((l) => l.href !== drag.key);
    else rs.splice(rs.findIndex((r) => r.key === drag.key), 1);
  }
}

const newId = () => Math.random().toString(36).slice(2, 8);

/** A new, empty folder at the end of the list. */
export function addFolder<L extends Linkish>(rows: MenuRow<L>[], name = "New folder"): { rows: MenuRow<L>[]; id: string } {
  const id = newId();
  return { rows: [...cloneRows(rows), { kind: "folder", key: folderKey(id), open: folderKey(id), name, id, custom: true, links: [] }], id };
}

export function renameFolder<L extends Linkish>(rows: MenuRow<L>[], key: string, name: string): MenuRow<L>[] {
  const clean = name.trim().slice(0, 30);
  if (!clean) return rows;
  return rows.map((r) => (r.kind === "folder" && r.custom && r.key === key ? { ...r, name: clean } : r));
}

/** Removes an own folder: its entries go back to the top level, where the folder was. */
export function deleteFolder<L extends Linkish>(rows: MenuRow<L>[], key: string): MenuRow<L>[] {
  const out: MenuRow<L>[] = [];
  for (const r of rows) {
    if (r.kind === "folder" && r.custom && r.key === key) for (const l of r.links) out.push({ kind: "link", key: l.href, link: l });
    else out.push(r);
  }
  return out;
}

/** What the server accepts back (a saved layout is data from the browser). */
export function cleanLayout(input: unknown): NavLayout | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
  if (!Array.isArray(o.folders) || !Array.isArray(o.top) || !o.inside || typeof o.inside !== "object" || Array.isArray(o.inside)) return null;
  if (o.folders.length > 12 || o.top.length > 100) return null;
  const folders: NavLayout["folders"] = [];
  for (const f of o.folders) {
    const r = f as Record<string, unknown>;
    if (!r || !str(r.id, 12) || !/^[a-z0-9]+$/.test(r.id as string) || !str(r.name, 30)) return null;
    folders.push({ id: r.id as string, name: (r.name as string).trim() });
  }
  const top: string[] = [];
  for (const k of o.top) {
    if (!str(k, 300)) return null;
    top.push(k);
  }
  const inside: NavLayout["inside"] = {};
  const entries = Object.entries(o.inside as Record<string, unknown>);
  if (entries.length > 30) return null;
  for (const [k, v] of entries) {
    if (!str(k, 300) || !Array.isArray(v) || v.length > 100) return null;
    const list: string[] = [];
    for (const h of v) {
      if (!str(h, 300)) return null;
      list.push(h);
    }
    inside[k] = list;
  }
  return { folders, top, inside };
}
