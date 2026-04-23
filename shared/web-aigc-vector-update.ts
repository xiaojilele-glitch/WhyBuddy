import type { RiskLevel } from "./permission/contracts.js";

export const WEB_AIGC_VECTOR_UPDATE_API = {
  EXECUTE: "POST /api/vector-update",
} as const;

export interface VectorUpdateSelectionByIds {
  ids: string[];
}

export interface VectorUpdateSelectionBySourceId {
  sourceId: string;
}

export type VectorUpdateSelection =
  | VectorUpdateSelectionByIds
  | VectorUpdateSelectionBySourceId;

export interface VectorUpdateMetadataPatch {
  [key: string]: unknown;
}

export interface VectorUpdateActionInput {
  agentId: string;
  token: string;
  namespace: string;
  collection?: string;
  projectId: string;
  sourceType?: string;
  selection: VectorUpdateSelection;
  metadataPatch: VectorUpdateMetadataPatch;
  requireApproval?: boolean;
  reason?: string;
  context?: Record<string, unknown>;
}

export interface VectorUpdateGovernanceSnapshot {
  namespace: string;
  collection: string;
  resource: string;
  riskLevel: RiskLevel;
  permission: {
    allowed: boolean;
    reason?: string;
    suggestion?: string;
  };
  approval: {
    required: boolean;
    status: "not_required" | "pending" | "approved";
  };
  audit: {
    logged: boolean;
    operation: "vector_update";
  };
  rollback: {
    supported: false;
    mode: "metadata_patch_only";
    reason: string;
  };
}

export interface VectorUpdateActionResult {
  ok: boolean;
  action: "vector_update";
  namespace: string;
  collection: string;
  selectionMode: "ids" | "sourceId";
  matchedRecords: number;
  updatedRecords: number;
  status:
    | "completed"
    | "denied"
    | "approval_required"
    | "unavailable"
    | "failed";
  governance: VectorUpdateGovernanceSnapshot;
  warning?: string;
  error?: string;
  updatedChunkIds?: string[];
  updatedSourceId?: string;
}
