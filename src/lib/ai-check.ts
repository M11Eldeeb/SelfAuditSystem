import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";

const MODEL = "claude-sonnet-5";

type AdminClient = ReturnType<typeof createAdminClient>;
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Runs AI checks for every ai_checkable question on a submitted assignment,
 * storing suggestions in ai_reviews for the officer to confirm/override.
 * q18 (submission lead time) is computed deterministically from claim dates
 * rather than via the model, since it's exact data.
 */
export async function runAiChecks(assignmentId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: assignment } = await supabase
    .from("audit_assignments")
    .select("*")
    .eq("id", assignmentId)
    .single();
  if (!assignment || assignment.status !== "submitted") return;

  const [{ data: claim }, { data: questions }, { data: answers }, { data: photos }] = await Promise.all([
    supabase.from("claims").select("*").eq("id", assignment.claim_id).single(),
    supabase.from("audit_questions").select("*").eq("ai_checkable", true).order("sort_order"),
    supabase.from("audit_answers").select("*").eq("assignment_id", assignmentId),
    supabase.from("audit_photos").select("*").eq("assignment_id", assignmentId),
  ]);

  if (!claim || !questions) return;

  const answerByQuestion = new Map((answers ?? []).map((a) => [a.question_id, a]));

  const q18 = questions.find((q) => q.id === "q18");
  if (q18) {
    await checkSubmissionLeadTime(supabase, assignmentId, claim);
  }

  const visionQuestions = questions.filter((q) => q.id !== "q18");

  if (visionQuestions.length > 0 && process.env.ANTHROPIC_API_KEY) {
    await runVisionChecks(supabase, assignmentId, claim, visionQuestions, answerByQuestion, photos ?? []);
  } else if (visionQuestions.length > 0) {
    console.error("ANTHROPIC_API_KEY not set - skipping AI vision checks for assignment", assignmentId);
  }

  await supabase
    .from("audit_assignments")
    .update({ status: "ai_checked" })
    .eq("id", assignmentId)
    .eq("status", "submitted");
}

async function checkSubmissionLeadTime(
  supabase: AdminClient,
  assignmentId: string,
  claim: { repair_end_date: string | null; dealer_submit_date: string | null }
) {
  if (!claim.repair_end_date || !claim.dealer_submit_date) return;

  const days = Math.round(
    (new Date(claim.dealer_submit_date).getTime() - new Date(claim.repair_end_date).getTime()) / 86_400_000
  );

  await supabase.from("ai_reviews").upsert(
    {
      assignment_id: assignmentId,
      question_id: "q18",
      ai_suggested_value: days < 5 ? "Yes" : "Other",
      ai_reasoning: `${days} day(s) between repair end date (${claim.repair_end_date}) and dealer submit date (${claim.dealer_submit_date}), per claims data.`,
      ai_confidence: "high",
    },
    { onConflict: "assignment_id,question_id" }
  );
}

async function runVisionChecks(
  supabase: AdminClient,
  assignmentId: string,
  claim: {
    claim_number: string;
    vin: string | null;
    mileage: number | null;
    part_serial_number: string | null;
    part_production_date: string | null;
  },
  questions: { id: string; text: string; options: string[]; ai_check_note: string | null }[],
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
      const answer = answerByQuestion.get(q.id)?.answer_value ?? "(not answered)";
      return `- ${q.id}: "${q.text}"\n  Options: ${q.options.join(", ")}\n  Branch admin's answer: ${answer}\n  Check guidance: ${q.ai_check_note ?? "n/a"}`;
    })
    .join("\n");

  const claimContext = [
    `Claim number: ${claim.claim_number}`,
    `VIN: ${claim.vin ?? "n/a"}`,
    `Mileage per claims data: ${claim.mileage ?? "n/a"}`,
    `Part serial number per claims data: ${claim.part_serial_number ?? "n/a"}`,
    `Part production date per claims data: ${claim.part_production_date ?? "n/a"}`,
  ].join("\n");

  const tool: Anthropic.Tool = {
    name: "report_audit_checks",
    description: "Report the suggested verdict for each audit question under review.",
    input_schema: {
      type: "object",
      properties: {
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question_id: { type: "string" },
              suggested_value: { type: "string" },
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
            text: `You are assisting a warranty auditor. Review the attached job card / repair agreement / parts requisition photos for one warranty claim, and the claims data below, then judge each question.

${claimContext}

Questions to check:
${questionBlock}

For each question, pick a suggested_value from that question's Options list, give a short reasoning citing what you saw in the photos or data, and a confidence level. If a photo needed for a question is missing or illegible, say so in the reasoning and use "low" confidence.`,
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
    await supabase.from("ai_reviews").upsert(rows, { onConflict: "assignment_id,question_id" });
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
