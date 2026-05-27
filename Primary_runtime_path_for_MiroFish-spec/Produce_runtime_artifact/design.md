{
  "artifact_id": "uuid-v4-string",
  "metadata": {
    "timestamp": "ISO-8601-UTC",
    "primary_route": "executor_backed_path",
    "version": "1.0",
    "source_task": "MiroFish_Request_ID"
  },
  "execution_summary": {
    "status": "success",
    "steps_executed": 5,
    "total_latency_ms": 1250
  },
  "live_evidence": {
    "callback_logs": [
      {
        "step": "api_call",
        "raw_response_digest": "sha256_hash",
        "live_token": "dynamic_runtime_key_001"
      }
    ],
    "executor_metadata": {
      "worker_node": "node-alpha",
      "environment_hash": "..."
    }
  },
  "blueprint_alignment": {
    "outputs": {
      "final_result": "...",
      "structured_data": { ... }
    }
  }
}