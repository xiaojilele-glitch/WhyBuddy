typescript
interface ExecutionState {
  runId: string;
  currentStep: 'Observation' | 'Planning' | 'ToolUse' | 'Synthesis' | 'Validation';
  history: StepArtifact[]; // 存储历史证据
  status: 'active' | 'paused' | 'completed' | 'failed';
}