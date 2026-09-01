import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-sonnet-5";

type AdminClient = ReturnType<typeof createAdminClient>;
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Runs AI checks for every ai_checkable question on a submitted assignment,
 * storing suggestions in ai_reviews for the officer to confirm/override.
 */
export async function runAiChecks(assignmentId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: assignment } = await supabase
    .from("self_audit_audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();
  if (!assignment || assignment.status !== "submitted") return;

  const [{ data: claim }, { data: questions }, { data: answers }, { data: photos }] = await Promise.all([
    supabase.from("self_audit_claims").select("*").eq("id", assignment.claim_id).single(),
    supabase.from("self_audit_audit_questions").select("*").eq("scope", "claim").eq("ai_checkable", true).order("sort_order"),
    supabase.from("self_audit_audit_answers").select("*").eq("assignment_id", assignmentId),
    supabase.from("self_audit_audit_photos").select("*").eq("assignment_id", assignmentId),
  ]);

  if (!claim || !questions) return;

  const answerByQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));

  if (questions.length > 0 && process.env.ANTHROPIC_API_KEY) {
    await runVisionChecks(supabase, assignmentId, claim, questions, answerByQuestion, photos ?? []);
  }
  // No ANTHROPIC_API_KEY configured: AI checks are optional, so this is expected, not an error.
  // The officer just judges every question manually in the review screen.

  await supabase
    .from("self_audit_audit_assignments")
    .update({ status: "ai_checked" })
    .eq("id", assignmentId)
    .eq("status", "submitted");
}

async function runVisionChecks(
  supabase: AdminClient,
  assignmentId: string,
  claim: {
    claim_number: string;
    vin: string | null;
    mileage: number | null;
    repair_end_date: string | null;
    dealer_submit_date: string | null;
    creation_date: string;
  },
  questions: { id: string; text: string; ai_check_note: string | null }[],
  answerByQuestion: Map<string, { answer_value: string | null }>,
  photos: { photo_type_id: string; storage_path: string }[]
) {
  const content: (Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] = [];

  for (const photo of photos) {
    const { data: file } = await supabase.storage.from("audit-photos").download(photo.storage_path);
    if (!file) continue;
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");

    if (photo.storage_path.toLowerCase().endsWith(".pdf")) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
        title: photo.photo_type_id,
      });
      continue;
    }

    const mediaType = guessImageMediaType(photo.storage_path);
    if (mediaType) {
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    }
  }

  const questionBlock = questions
    .map((q) => {
      const answer = answerByQuestion.get(q.id)?.answer_value;
      return `- ${q.id}: "${q.text}"\n  Branch admin's answer: ${answer != null ? `${answer}%` : "(not answered)"}\n  Check guidance: ${q.ai_check_note ?? "n/a"}`;
    })
    .join("\n");

  const claimContext = [
    `Claim number: ${claim.claim_number}`,
    `VIN: ${claim.vin ?? "n/a"}`,
    `Mileage per claims data: ${claim.mileage ?? "n/a"}`,
    `Reception/creation date per claims data: ${claim.creation_date}`,
    `Repair end date per claims data: ${claim.repair_end_date ?? "n/a"}`,
    `Dealer submit date per claims data: ${claim.dealer_submit_date ?? "n/a"}`,
  ].join("\n");

  const tool: Anthropic.Tool = {
    name: "report_audit_checks",
    description: "Report the suggested score for each audit question under review.",
    input_schema: {
      type: "object",
      properties: {
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_id: { type: "string" },
              suggested_value: {
                type: "string",
                enum: ["0", "25", "50", "75", "100"],
                description: "Compliance score for this question.",
              },
              reasoning: { type: "string" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["question_id", "suggested_value", "reasoning", "confidence"],
          },
        },
      },
      required: ["checks"],
    },
  };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [tool],
    tool_choice: { type: "tool", name: "report_audit_checks" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You are assisting a warranty auditor. Review the attached job card / repair agreement / parts requisition photos for one warranty claim, and the claims data below, then score each question on a 0/25/50/75/100 scale:
- 100: fully compliant, no issues.
- 75: compliant with a minor issue (e.g. present but slightly incomplete or hard to read).
- 50: partially compliant (e.g. present but missing a required element).
- 25: mostly missing or a significant issue.
- 0: completely missing or absent.

${claimContext}

Questions to check:
${questionBlock}

For each question, give a suggested_value from that scale, a short reasoning citing what you saw in the photos or data, and a confidence level. If a photo needed for a question is missing or illegible, say so in the reasoning and use "low" confidence.`,
          },
          ...content,
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return;

  const input = toolUse.input as {
    checks?: { question_id: string; suggested_value: string; reasoning: string; confidence: string }[];
  };
  const validIds = new Set(questions.map((q) => q.id));
  const rows = (input.checks ?? [])
    .filter((c) => validIds.has(c.question_id))
    .map((c) => ({
      assignment_id: assignmentId,
      question_id: c.question_id,
      ai_suggested_value: c.suggested_value,
      ai_reasoning: c.reasoning,
      ai_confidence: c.confidence,
    }));

  if (rows.length > 0) {
    await supabase.from("self_audit_ai_reviews").upsert(rows, { onConflict: "assignment_id,question_id" });
  }
}

function guessImageMediaType(path: string): ImageMediaType | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}
