"use client";

import { useActionState } from "react";
import { saveAudit } from "./actions";
import { QuestionField } from "./question-field";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];
type PhotoType = Database["public"]["Tables"]["audit_photo_types"]["Row"];

export function AuditForm({
  assignmentId,
  questions,
  photoTypes,
  answers,
  photoUrls,
  noteText,
  locked,
}: {
  assignmentId: string;
  questions: Question[];
  photoTypes: PhotoType[];
  answers: Map<string, { answer_value: string | null; conditional_value: string | null }>;
  photoUrls: Map<string, string>;
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
            initialConditional={answers.get(q.id)?.conditional_value ?? null}
            locked={locked}
          />
        ))}
      </div>

      <div className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Required photos</h2>
        {photoTypes.map((pt) => (
          <div key={pt.id} className="space-y-1">
            <label className="text-sm font-medium text-neutral-700">
              {pt.label}
              {pt.required && <span className="text-red-500"> *</span>}
            </label>
            {pt.help_text && <p className="text-xs text-neutral-500">{pt.help_text}</p>}
            {photoUrls.get(pt.id) && (
              <a
                href={photoUrls.get(pt.id)}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-blue-600 underline"
              >
                View current photo
              </a>
            )}
            {!locked && (
              <input
                type="file"
                name={`photo_${pt.id}`}
                accept="image/*,application/pdf"
                className="block text-sm"
              />
            )}
          </div>
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
            disabled={pending}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? "Submitting..." : "Submit audit"}
          </button>
        </div>
      )}
    </form>
  );
}
