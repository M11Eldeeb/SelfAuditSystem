"use client";

import { useState } from "react";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["audit_questions"]["Row"];

export function ReviewField({
  question,
  adminAnswer,
  adminConditional,
  aiSuggestedValue,
  aiReasoning,
  aiConfidence,
  officerValue,
}: {
  question: Question;
  adminAnswer: string | null;
  adminConditional: string | null;
  aiSuggestedValue: string | null;
  aiReasoning: string | null;
  aiConfidence: string | null;
  officerValue: string | null;
}) {
  const [value, setValue] = useState(officerValue ?? aiSuggestedValue ?? adminAnswer ?? "");

  return (
    <fieldset className="space-y-2 border-b border-neutral-100 pb-4">
      <legend className="text-sm font-medium text-neutral-900">{question.text}</legend>
      {question.help_text && <p className="text-xs text-neutral-500">{question.help_text}</p>}

      <p className="text-xs text-neutral-600">
        Branch admin answered:{" "}
        <span className="font-medium text-neutral-900">{adminAnswer ?? "(no answer)"}</span>
        {adminConditional && <span className="text-neutral-500"> ({adminConditional})</span>}
      </p>

      {aiSuggestedValue && (
        <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <p>
            AI suggests: <span className="font-medium">{aiSuggestedValue}</span>{" "}
            <span className="text-blue-600">({aiConfidence} confidence)</span>
          </p>
          {aiReasoning && <p className="mt-0.5 text-blue-800">{aiReasoning}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-4">
        {question.options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 text-sm text-neutral-700">
            <input
              type="radio"
              name={`officer_${question.id}`}
              value={opt}
              checked={value === opt}
              onChange={() => setValue(opt)}
              required
            />
            {opt}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
