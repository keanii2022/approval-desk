// Every eval set by name, as `npm run evals -- --set <name>` and `npm run drift` know them.
import { amountCases } from "./amount-cases.ts";
import { type PracticeCase, practiceCases } from "./cases.ts";
import { dateCases } from "./date-cases.ts";
import { disguiseCases } from "./disguise-cases.ts";
import { edgeCases } from "./edge-cases.ts";
import { fieldCases } from "./field-cases.ts";
import { hardCases } from "./hard-cases.ts";
import { hard2Cases } from "./hard2-cases.ts";
import { holeCases } from "./hole-cases.ts";
import { stackCases } from "./stack-cases.ts";
import { twoOrderCases } from "./two-order-cases.ts";

export const SETS: Record<string, PracticeCase[]> = {
  practice: practiceCases,
  hard: hardCases,
  hard2: hard2Cases as PracticeCase[],
  holes: holeCases,
  edges: edgeCases,
  disguise: disguiseCases,
  stack: stackCases,
  two: twoOrderCases,
  field: fieldCases,
  amount: amountCases,
  date: dateCases,
};
