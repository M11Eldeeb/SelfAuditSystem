"use client";

import { useActionState } from "react";
import { saveAudit } from "./actions";
import { QuestionField } from "@/components/question-field";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { Database } from "@/lib/supabase/types";
import type { PhotoStatus } from "@/lib/photo-status";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];
type PhotoType = Database["public"]["Tables"]["self_audit_audit_photo_types"]["Row"];

export function AuditForm({
  assignmentId,
  questions,
  photoTypes,
  answers,
  photoStatus,
  noteText,
  locked,
}: {
  assignmentId: string;
  questions: Question[];
  photoTypes: PhotoType[];
  answers: Map<string, { answer_value: string | null; conditional_value: string | null }>;
  photoStatus: Map<string, PhotoStatus>;
  noteText: string;
  locked: boolean;
}) {
  const boundSave = saveAudit.bind(null, assignmentId);
  const [state, formAction, pending] = useActionState(boundSave, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Audit questions</h2>
        {questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            initialValue={answers.get(q.id)?.answer_value ?? null}
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
            buildPath={(ext) => `${assignmentId}/${pt.id}.${ext}`}
          />
        ))}
      </div>

      <div className="space-y-1 rounded-lg border border-neutral-200 bg-white p-4">
        <label htmlFor="note" className="text-sm font-medium text-neutral-700">
          Additional note
        </label>
        <textarea
          id="note"
          name="note"
          rows={3}
          defaultValue={noteText}
          disabled={locked}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <div className="flex gap-3">
          <button
            type="submit"
            name="intent"
            value="draft"
            formNoValidate
            disabled={pending}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            type="submit"
            name="intent"
            value="submit"
            formNoValidate
            disabled={pending}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
          >
            {pending ? "Submitting..." : "Submit audit"}
          </button>
        </div>
      )}
    </form>
  );
}
