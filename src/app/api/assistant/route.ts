import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaTextBlockParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { assistantUser, type Row } from "@/lib/assistant/data";
import { TOOLS, runTool, type Proposal, type ResultTable } from "@/lib/assistant/tools";

export const maxDuration = 120;

const MODEL = "claude-sonnet-5-5";
const MAX_STEPS = 8;

const SYSTEM = `You are Morris, the MG portal assistant for Jiad Modern Motors (MG after-sales, Saudi Arabia). You help warranty officers, the national manager and service managers with questions about their branches: open WIPs (job cards), warranty claims and KPIs, complaints, courtesy cars and agreements, the customer queue, appointments and technician claims.

Your name Morris comes from Morris Garages, where MG began (MG = Morris Garages, Oxford, 1924). In Arabic you are "موريس".

How to work:
- Answer in the language the person writes in (Arabic or English). Keep answers short and practical: the answer first, then the few figures that support it.
- Always get figures from the tools. Never guess or invent a number, a name or a status. If the data does not hold the answer, say so plainly and say what is missing.
- Use query_data with group_by for counts and totals; ask for rows only when the person wants a list. For a list or report set show_table so they get a downloadable table, and only summarise it in your text (do not repeat every row).
- Use lookup for one WIP, VIN, plate or claim.
- Money is in SAR. Dates are Saudi time. Say which period the figures cover.
- To change something, use propose_action. The change only happens when the person presses Confirm, so say "please confirm below", never that it is done.
- You can only read the data listed in your tools and make the changes listed in propose_action. For anything else, tell the person where in the portal to do it.
- Use simple markdown: short paragraphs, bullet lists, bold for key figures. Small tables (up to ~8 rows) may be markdown tables.`;

type Turn = { role: "user" | "assistant"; text: string };

export async function POST(req: Request) {
  const au = await assistantUser();
  if (!au) return Response.json({ error: "The assistant is for warranty officers, the national manager and service managers." }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "The assistant is not set up (no API key)." }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { history?: Turn[]; message?: string } | null;
  const message = String(body?.message ?? "").trim().slice(0, 4000);
  if (!message) return Response.json({ error: "Write a question." }, { status: 400 });
  const history = (body?.history ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.text === "string" && t.text.trim())
    .slice(-20)
    .map((t): BetaMessageParam => ({ role: t.role, content: t.text.slice(0, 8000) }));
  // The conversation must start with the person and alternate.
  while (history.length && history[0].role !== "user") history.shift();
  const messages: BetaMessageParam[] = [];
  for (const m of history) {
    if (messages.length && messages[messages.length - 1].role === m.role) messages[messages.length - 1] = m;
    else messages.push(m);
  }
  if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  messages.push({ role: "user", content: message });

  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const system: BetaTextBlockParam[] = [
    { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: `The person: ${au.user.full_name ?? au.user.email}, ${au.label}${au.user.viewOnly ? ", view-only account" : ""}. Today is ${today}.` },
  ];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const cache = new Map<string, Row[]>();
  const tables: ResultTable[] = [];
  const proposals: Proposal[] = [];
  const texts: string[] = [];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system,
        tools: TOOLS,
        messages,
      });
      const content = res.content as BetaContentBlock[];
      for (const b of content) if (b.type === "text" && b.text.trim()) texts.push(b.text.trim());

      if (res.stop_reason === "refusal") {
        texts.push("I can't help with that one.");
        break;
      }
      if (res.stop_reason !== "tool_use") break;

      messages.push({ role: "assistant", content: res.content as BetaMessageParam["content"] });
      const results: BetaToolResultBlockParam[] = [];
      for (const b of content) {
        if (b.type !== "tool_use") continue;
        const r = await runTool(b.name, (b.input ?? {}) as Record<string, unknown>, au, cache);
        if (r.table) tables.push(r.table);
        if (r.proposal) proposals.push(r.proposal);
        results.push({ type: "tool_result", tool_use_id: b.id, content: r.result, is_error: r.isError || undefined });
      }
      messages.push({ role: "user", content: results });
      if (step === MAX_STEPS - 1) texts.push("(I stopped here - the question needed too many steps. Try asking a narrower question.)");
    }
  } catch (e) {
    console.error("[assistant]", e);
    const msg = e instanceof Anthropic.APIError && e.status === 429 ? "The assistant is busy, try again in a minute." : "The assistant could not answer right now. Try again.";
    return Response.json({ error: msg }, { status: 502 });
  }

  // Only the final answer goes back to the chat; earlier "let me check" lines are dropped.
  const answer = texts.length ? texts[texts.length - 1] : "I could not find an answer.";
  return Response.json({ answer, tables, proposals });
}
