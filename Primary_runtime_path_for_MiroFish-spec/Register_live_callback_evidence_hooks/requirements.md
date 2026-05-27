typescript
interface ICallbackHook {
  onEvent(event: RuntimeEvent): Promise<void>;
}

interface RuntimeEvent {
  type: MilestoneType;
  timestamp: string;
  traceId: string;
  payload: Record<string, any>;
  metadata: {
    role: string;
    executorId: string;
  };
}

enum MilestoneType {
  REQUEST_ACCEPTED = "REQUEST_ACCEPTED",
  CONTEXT_RESOLVED = "CONTEXT_RESOLVED",
  EXECUTOR_STARTED = "EXECUTOR_STARTED",
  STEP_COMPLETED = "STEP_COMPLETED",
  ARTIFACT_EMITTED = "ARTIFACT_EMITTED",
  VALIDATION_PASSED = "VALIDATION_PASSED",
  VALIDATION_FAILED = "VALIDATION_FAILED",
  FALLBACK_TRIGGERED = "FALLBACK_TRIGGERED"
}