import type { PartReturnItem } from "@/lib/part-returns";
import type { PartFlag } from "@/lib/part-return-flags";
import { FlagBadges } from "./flag-badges";

const ITEM_TONE: Record<PartReturnItem["status"], string> = {
  requested: "bg-amber-50 text-amber-700",
  dispatched: "bg-blue-50 text-blue-700",
  missing: "bg-red-50 text-red-700",
};
const ITEM_LABEL: Record<PartReturnItem["status"], string> = {
  requested: "Requested",
  dispatched: "Dispatched",
  missing: "Missing",
};

/** Read-only list of a request's claims and parts, grouped by claim. */
export function ItemsTable({
  items,
  renderAction,
  flags,
}: {
  items: PartReturnItem[];
  renderAction?: (item: PartReturnItem) => React.ReactNode;
  flags?: Record<string, PartFlag[]>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200/70 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-left text-xs font-semibold tracking-wide text-neutral-500 uppercase">
          <tr>
            <th className="px-4 py-2">Claim</th>
            <th className="px-4 py-2">VIN</th>
            <th className="px-4 py-2">Part</th>
            <th className="px-4 py-2 text-right">Qty</th>
            <th className="px-4 py-2">Status</th>
            {renderAction && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {items.map((i) => (
            <tr key={i.id} className="align-top hover:bg-neutral-50">
              <td className="px-4 py-2.5">
                <div className="font-semibold text-neutral-900">{i.claim_number}</div>
                <div className="text-xs text-neutral-500">{i.work_order_no}</div>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs">{i.vin ?? "—"}</td>
              <td className="px-4 py-2.5">
                <div>
                  {i.part_name ?? "—"}
                  <FlagBadges flags={flags?.[i.id]} />
                </div>
                <div className="font-mono text-xs text-neutral-500">{i.part_no}</div>
              </td>
              <td className="px-4 py-2.5 text-right">{i.quantity ?? 1}</td>
              <td className="px-4 py-2.5">
                <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ITEM_TONE[i.status]}`}>{ITEM_LABEL[i.status]}</span>
                {i.missing_reason && <div className="mt-1 max-w-64 text-xs text-neutral-600">“{i.missing_reason}”</div>}
              </td>
              {renderAction && <td className="px-4 py-2.5">{renderAction(i)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
