"use client";

import { SCORE_LEVELS, scoreLevelClasses } from "@/lib/score-scale";

export function ScorePicker({
  name,
  value,
  onChange,
  required,
  disabled,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300 bg-white shadow-sm">
      {SCORE_LEVELS.map((level, i) => (
        <label
          key={level}
          className={`relative cursor-pointer border-neutral-300 px-3 py-1.5 text-sm font-semibold transition has-[:focus-visible]:z-10 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-1 ${
            i > 0 ? "border-l" : ""
          } ${scoreLevelClasses(level, value === level)} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={level}
            checked={value === level}
            onChange={() => onChange(level)}
            required={required}
            disabled={disabled}
            className="sr-only"
          />
          {level}%
        </label>
      ))}
    </div>
  );
}
