import type { OutcomeMarker } from "../types";

export type BaselineVerdict = {
  accepted: boolean;
  reasons: string[];
  /** Optional explicit taxonomy marker for outcomes the booleans cannot express. */
  marker?: OutcomeMarker;
};
