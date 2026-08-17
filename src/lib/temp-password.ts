import { randomInt } from "node:crypto";

const WORDS = [
  "amber", "cedar", "delta", "ember", "flint", "grove", "haven", "inlet",
  "jade", "karst", "lumen", "maple", "nomad", "opal", "pixel", "quartz",
  "ridge", "slate", "tundra", "unity", "vapor", "willow", "xenon", "yield",
];

/** Human-typeable temp password: word-word-4digits. Officer relays this to the branch admin. */
export function generateTempPassword(): string {
  const w1 = WORDS[randomInt(WORDS.length)];
  const w2 = WORDS[randomInt(WORDS.length)];
  const digits = randomInt(1000, 10000);
  return `${w1}-${w2}-${digits}`;
}
