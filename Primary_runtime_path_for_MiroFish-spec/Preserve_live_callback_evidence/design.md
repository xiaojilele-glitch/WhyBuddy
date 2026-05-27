{
  "evidence_id": "uuid-v4-string",
  "correlation_id": "run-id-12345",
  "sequence_number": 5,
  "timestamp": "2023-10-27T10:00:00.123Z",
  "event_type": "EXECUTOR_ACTION_START",
  "status": "IN_PROGRESS",
  "actor": {
    "role": "agent-executor",
    "path": "/core/executor/v1"
  },
  "payload_summary": {
    "action": "database_query",
    "parameters_redacted": ["query_type", "table_name"],
    "result_digest": "sha256:..."
  },
  "path_proof": "signature_from_backend_executor"
}