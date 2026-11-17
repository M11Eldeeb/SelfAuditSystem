import { getDeskBoard } from "@/app/actions/queue";
import { queuePage } from "@/lib/queue/pages";
import { Desk } from "@/components/queue/desk";
import { BranchTabs } from "@/components/queue/branch-tabs";

/** The branch's service desk: Call next customer (advisors), the waiting list and assigning (managers). */
export default async function ServiceDeskPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { a, branch } = await queuePage(code, "service");
  const board = await getDeskBoard(branch.id, "service");
  if ("error" in board) return <p className="text-sm text-red-600">{board.error}</p>;
  return (
    <>
      <BranchTabs code={branch.queue_code} name={branch.name} active="service" manager={a.role === "manager"} role={a.role} />
      <Desk branch={{ id: branch.id, name: branch.name, code: branch.queue_code }} kind="service" initial={board} />
    </>
  );
}
