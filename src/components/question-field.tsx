"use client";

import { useState } from "react";
import { ScorePicker } from "@/components/score-picker";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];

export function QuestionField({
  question,
  initialValue,
  locked,
  reference,
}: {
  question: Question;
  initialValue: string | null;
  locked: boolean;
  reference?: string | null;
}) {
  const [value, setValue] = useState(initialValue ?? "");

  return (
    <fieldset className="space-y-2 border-b border-neutral-100 pb-4">
      <legend className="text-sm font-medium text-neutral-900">
        {question.text}
        {question.required && <span className="text-red-500"> *</span>}
      </legend>
      {question.help_text && <p className="text-xs text-neutral-500">{question.help_text}</p>}
      {reference && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Per claims data: <span className="font-medium">{reference}</span>
        </p>
      )}
      <ScorePicker
        name={`answer_${question.id}`}
        value={value}
        onChange={setValue}
        required={question.required}
        disabled={locked}
      />
    </fieldset>
  );
}
