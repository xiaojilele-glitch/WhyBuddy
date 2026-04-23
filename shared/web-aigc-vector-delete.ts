import type { SourceType } from "./rag/contracts.js";
import type { RiskLevel } from "./permission/contracts.js";

export const WEB_AIGC_VECTOR_DELETE_API = {
  EXECUTE: "POST /api/vector-delete",
} as const;

export interface VectorDeleteTarget {
  ids?: string[];
  sourceId?: string;
  sourceType?: SourceType;
  projectId?: string;
}

export interface VectorDeleteConfirmation {
  confirmed: boolean;
  confirmationText?: string;
  reason?: string;
}

export interface VectorDeleteActionInput {
  agentId: string;
  token: string;
  namespace: string;
  collection?: string;
  target: VectorDeleteTarget;
  confirmation: VectorDeleteConfirmation;
  requireApproval?: boolean;
  metadata?: Record<string, unknown>;
}

export interface VectorDeleteGovernanceSnapshot {
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
}

export interface VectorDeleteImpactSummary {
  requestedDeleteCount: number;
  matchedChunkCount: number;
  deletedChunkCount: number;
  remainingChunkCount: number;
  matchedSourceIds: string[];
  affectedProjectIds: string[];
  affectedSourceTypes: SourceType[];
}

export interface VectorDeleteActionResult {
  ok: boolean;
  action: "vector_delete";
  namespace: string;
  collection: string;
  status: "completed" | "denied" | "approval_required" | "unavailable" | "failed";
  deletedIds: string[];
  sourceId?: string;
  sourceType?: SourceType;
  governance: VectorDeleteGovernanceSnapshot;
  impact: VectorDeleteImpactSummary;
  confirmation: {
    confirmed: boolean;
    confirmationText?: string;
    protected: boolean;
  };
  error?: string;
}
