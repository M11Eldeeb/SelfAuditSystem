"use client";

import { useState } from "react";
import { ScorePicker } from "@/components/score-picker";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

export function QuestionField({
  question,
  initialValue,
  locked,
}: {
  question: Question;
  initialValue: string | null;
  locked: boolean;
}) {
  const [value, setValue] = useState(initialValue ?? "");

  return (
    <fieldset className="space-y-2 border-b border-neutral-100 pb-4">
      <legend className="text-sm font-medium text-neutral-900">
        {question.text}
        {question.required && <span className="text-red-500"> *</span>}
      </legend>
      {question.help_text && <p className="text-xs text-neutral-500">{question.help_text}</p>}
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
