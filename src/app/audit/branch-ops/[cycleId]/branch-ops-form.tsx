"use client";

import { useActionState } from "react";
import { saveBranchOps } from "./actions";
import { QuestionField } from "@/components/question-field";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { Database } from "@/lib/supabase/types";
import type { PhotoStatus } from "@/lib/photo-status";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];
type PhotoType = Database["public"]["Tables"]["self_audit_audit_photo_types"]["Row"];

export function BranchOpsForm({
  cycleId,
  branchId,
  questions,
  answers,
  photoTypes,
  photoStatus,
  locked,
}: {
  cycleId: string;
  branchId: string;
  questions: Question[];
  answers: Map<string, string | null>;
  photoTypes: PhotoType[];
  photoStatus: Map<string, PhotoStatus>;
  locked: boolean;
}) {
  const boundSave = saveBranchOps.bind(null, cycleId);
  const [state, formAction, pending] = useActionState(boundSave, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Questions</h2>
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            initialValue={answers.get(q.id) ?? null}
            locked={locked}
          />
        ))}
      </div>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Required photos</h2>
        {photoTypes.map((pt) => (
          <PhotoUploadField
            key={pt.id}
            label={pt.label}
            helpText={pt.help_text}
            required={pt.required}
            locked={locked}
            status={photoStatus.get(pt.id)}
            fieldName={`photo_path_${pt.id}`}
            buildPath={(ext) => `branch-ops/${branchId}/${cycleId}/${pt.id}.${ext}`}
          />
        ))}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <button
          type="submit"
          formNoValidate
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Submitting..." : "Submit branch operations"}
        </button>
      )}
    </form>
  );
}
