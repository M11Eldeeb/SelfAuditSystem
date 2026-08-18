"use client";

import { useState } from "react";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

export function QuestionField({
  question,
  initialValue,
  initialConditional,
  locked,
}: {
  question: Question;
  initialValue: string | null;
  initialConditional: string | null;
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
      <div className="flex flex-wrap gap-4">
        {question.options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-sm text-neutral-700">
            <input
              type="radio"
              name={`answer_${question.id}`}
              value={opt}
              checked={value === opt}
              onChange={() => setValue(opt)}
              required={question.required}
              disabled={locked}
              className="accent-brand"
            />
            {opt}
          </label>
        ))}
      </div>
      {question.conditional_field && value === question.conditional_field.shows_when_option && (
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-700">
            {question.conditional_field.field_label}
          </label>
          <input
            type={question.conditional_field.field_type === "number" ? "number" : "text"}
            name={`conditional_${question.id}`}
            defaultValue={initialConditional ?? ""}
            disabled={locked}
            className="w-40 rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
        </div>
      )}
    </fieldset>
  );
}
