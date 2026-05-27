typescript
interface ExecutorBinding {
  bindingId: string;
  agentId: string;
  backendType: 'docker' | 'lambda' | 'process';
  route: string;
  // 抽象凭据引用
  credentialRefs: Record<string, string>;
  // 生命周期钩子映射
  callbacks: {
    onEvent: (event: ExecutionEvent) => void;
  };
  // 资源约束
  limits: {
    cpu: number;
    memory: string;
    timeoutMs: number;
  };
}

interface ExecutionEvent {
  type: 'lifecycle' | 'artifact' | 'log';
  payload: any;
  timestamp: number;
  evidence: string; // 用于存证的原始数据片段或签名
}