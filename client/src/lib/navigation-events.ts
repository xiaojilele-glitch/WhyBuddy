export const OFFICE_DESKTOP_OPEN_MORE_EVENT = "office-desktop-open-more";
export const OFFICE_RUNTIME_EVIDENCE_EVENT = "office-runtime-evidence";

export type OfficeRuntimeEvidenceTab = "logs" | "artifacts" | "runtime";

export interface OfficeRuntimeEvidenceDetail {
  tab?: OfficeRuntimeEvidenceTab;
  missionId?: string | null;
}

export function createOfficeRuntimeEvidenceEvent(
  tab: OfficeRuntimeEvidenceTab,
  missionId?: string | null
): CustomEvent<OfficeRuntimeEvidenceDetail> {
  return new CustomEvent<OfficeRuntimeEvidenceDetail>(
    OFFICE_RUNTIME_EVIDENCE_EVENT,
    {
      detail: {
        tab,
        missionId: missionId ?? null,
      },
    }
  );
}

export function dispatchOfficeRuntimeEvidenceEvent(
  tab: OfficeRuntimeEvidenceTab,
  missionId?: string | null
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(createOfficeRuntimeEvidenceEvent(tab, missionId));
}
