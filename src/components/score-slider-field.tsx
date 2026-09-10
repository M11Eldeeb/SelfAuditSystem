"use client";

import { useState } from "react";
import type { Database } from "@/lib/supabase/types";

type Question = Database["public"]["Tables"]["self_audit_audit_questions"]["Row"];

function trackAccentClass(value: number): string {
  if (value < 50) return "accent-red-600";
  if (value < 75) return "accent-amber-500";
  if (value < 90) return "accent-lime-500";
  return "accent-emerald-600";
}

/**
 * A free-value 0-100 slider, for questions that need finer scoring than the
 * fixed 0/25/50/75/100 buttons ScorePicker offers (e.g. Branch Operation
 * checkpoints, where an officer may want to score something at 82% rather
 * than rounding to the nearest bucket). Scoring already treats any 0-100
 * number generically (see scoreAnswer() in src/lib/scoring.ts), so this
 * needed no data-model change - only a different input control.
 */
export function ScoreSliderField({
  question,
  initialValue,
  locked,
}: {
  question: Question;
  initialValue: string | null;
  locked: boolean;
}) {
  const [value, setValue] = useState<number | null>(
    initialValue != null && initialValue !== "" ? Number(initialValue) : null
  );
  // The <input type="range"> always needs a thumb position even before the
  // officer has set a real value - 50 is just that starting position, not a
  // submitted answer. The hidden field below (empty until `value` is set)
  // is what's actually submitted, so an untouched slider still saves as
  // unanswered, same as an unclicked ScorePicker.
  const thumbPosition = value ?? 50;

  return (
    <fieldset className="space-y-2 border-b border-neutral-100 pb-4">
      <legend className="text-sm font-medium text-neutral-900">
        {question.text}
        {question.required && <span className="text-red-500"> *</span>}
      </legend>
      {question.help_text && <p className="text-xs text-neutral-500">{question.help_text}</p>}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={thumbPosition}
          disabled={locked}
          onChange={(e) => setValue(Number(e.target.value))}
          className={`h-2 flex-1 cursor-pointer rounded-full bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60 ${trackAccentClass(thumbPosition)} ${value == null ? "opacity-40" : ""}`}
        />
        <span className="w-16 text-right text-sm font-semibold tabular-nums text-neutral-900">
          {value == null ? "Not set" : `${value}%`}
        </span>
      </div>
      <input type="hidden" name={`answer_${question.id}`} value={value ?? ""} />
    </fieldset>
  );
}
