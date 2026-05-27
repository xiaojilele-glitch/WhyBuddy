{
  "envelope_id": "uuid-v4",
  "target": {
    "repo_url": "https://github.com/666ghj/MiroFish",
    "ref": "main"
  },
  "route_config": {
    "primary_path": "executor-backed-role-agent",
    "steps": [...]
  },
  "artifact_spec": {
    "types": ["logs", "performance_metrics", "snapshots"]
  },
  "callbacks": {
    "stream_url": "wss://api.rcouyi.com/v1/stream",
    "evidence_persistence": true
  },
  "runtime_constraints": {
    "max_duration_sec": 3600,
    "memory_limit_mb": 2048
  },
  "environment_context": {
    "mode": "production",
    "redacted_vars": ["API_KEY", "DB_PASSWORD"] 
  }
}