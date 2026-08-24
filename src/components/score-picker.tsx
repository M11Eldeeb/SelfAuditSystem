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
    <div className="inline-flex overflow-hidden rounded-md border border-neutral-300">
      {SCORE_LEVELS.map((level, i) => (
        <label
          key={level}
          className={`cursor-pointer border-neutral-300 px-3 py-1.5 text-sm font-semibold transition ${
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
