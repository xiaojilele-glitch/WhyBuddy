{
      "plan_id": "uuid",
      "agent_config": {
        "role": "string",
        "instructions": "string",
        "tools": ["executor_id_1", "..."]
      },
      "artifact_schema": { "type": "object", "properties": { ... } },
      "callback_config": {
        "evidence_storage": "path/to/evidence",
        "hooks": ["logger", "metrics", "live_stream"]
      },
      "constraints": {
        "max_iterations": 10,
        "timeout_seconds": 300
      }
    }