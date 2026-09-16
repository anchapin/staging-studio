export interface InpaintPersistenceState {
  status: string;
  resultUrl: string | null;
}

export type InpaintPersistenceDecision =
  | { kind: "return-stored"; url: string }
  | { kind: "persist" };

export function decideInpaintPersistence(
  state: InpaintPersistenceState
): InpaintPersistenceDecision {
  if (
    state.status === "COMPLETED" &&
    typeof state.resultUrl === "string" &&
    state.resultUrl.length > 0
  ) {
    return { kind: "return-stored", url: state.resultUrl };
  }

  return { kind: "persist" };
}
