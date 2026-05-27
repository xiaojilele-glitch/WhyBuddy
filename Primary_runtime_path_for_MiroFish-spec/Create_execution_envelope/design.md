{
  "header": {
    "version": "1.0",
    "request_id": "uuid-v4",
    "timestamp": "ISO-8601"
  },
  "context": {
    "repository": {
      "url": "https://github.com/666ghj/MiroFish",
      "ref": "main"
    },
    "route": "selected_primary_path"
  },
  "payload": {
    "artifact_request": "type_specified",
    "runtime_limits": {
      "max_duration_sec": 3600,
      "memory_mb": 2048,
      "cpu_cores": 2
    },
    "env_vars": {
      "PUBLIC_VAR": "value",
      "SECRET_REF": "REDACTED_SECRET_ID" 
    }
  },
  "observability": {
    "callback_channels": [
      {
        "type": "streaming_logs",
        "url": "https://callback.internal/stream"
      },
      {
        "type": "evidence_preservation",
        "url": "https://callback.internal/evidence"
      }
    ]
  }
}