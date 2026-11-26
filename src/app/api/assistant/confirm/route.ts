import { assistantUser } from "@/lib/assistant/data";
import { execute, verify } from "@/lib/assistant/tools";

/** Runs a change the assistant proposed, after the person pressed Confirm. The token is signed for this person and expires. */
export async function POST(req: Request) {
  const au = await assistantUser();
  if (!au) return Response.json({ ok: false, message: "Not allowed." }, { status: 403 });
  if (au.user.viewOnly) return Response.json({ ok: false, message: "This account is view only." }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  const p = verify(String(body?.token ?? ""), au.user.id);
  if (!p) return Response.json({ ok: false, message: "This proposal has expired. Ask the assistant again." }, { status: 400 });
  return Response.json(await execute(p));
}
