"use client";

import { useActionState } from "react";
import { saveBranchOps } from "./actions";
import { QuestionField } from "@/components/question-field";
import type { Database } from "@/lib/supabase/types";
import type { PhotoStatus } from "@/lib/photo-status";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];
type PhotoType = Database["public"]["Tables"]["audit_photo_types"]["Row"];

export function BranchOpsForm({
  cycleId,
  questions,
  answers,
  photoTypes,
  photoStatus,
  locked,
}: {
  cycleId: string;
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
        {photoTypes.map((pt) => {
          const status = photoStatus.get(pt.id);
          return (
            <div key={pt.id} className="space-y-1">
              <label className="text-sm font-medium text-neutral-700">
                {pt.label}
                {pt.required && <span className="text-red-500"> *</span>}
              </label>
              {pt.help_text && <p className="text-xs text-neutral-500">{pt.help_text}</p>}
              {status && "url" in status && (
                <a
                  href={status.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-xs text-brand underline"
                >
                  View current photo
                </a>
              )}
              {status && "removed" in status && (
                <p className="text-xs text-neutral-400">Photo removed after review to save storage.</p>
              )}
              {!locked && (
                <input
                  type="file"
                  name={`photo_${pt.id}`}
                  accept="image/*,application/pdf"
                  className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 file:shadow-sm hover:file:bg-neutral-50"
                />
              )}
            </div>
          );
        })}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      {!locked && (
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Submitting..." : "Submit branch operations"}
        </button>
      )}
    </form>
  );
}
