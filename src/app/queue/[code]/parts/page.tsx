import { getDeskBoard } from "@/app/actions/queue";
import { queuePage } from "@/lib/queue/pages";
import { Desk } from "@/components/queue/desk";
import { BranchTabs } from "@/components/queue/branch-tabs";

/** The branch's spare parts desk (its own queue; service advisors never see it). */
export default async function PartsDeskPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { a, branch } = await queuePage(code, "parts");
  const board = await getDeskBoard(branch.id, "parts");
  if ("error" in board) return <p className="text-sm text-red-600">{board.error}</p>;
  return (
    <>
      <BranchTabs code={branch.queue_code} name={branch.name} active="parts" manager={a.role === "manager"} role={a.role} />
      <Desk branch={{ id: branch.id, name: branch.name, code: branch.queue_code }} kind="parts" initial={board} />
    </>
  );
}
