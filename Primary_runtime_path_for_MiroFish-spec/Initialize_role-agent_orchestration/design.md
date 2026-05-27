{
      "type": "object",
      "properties": {
        "status": { "type": "string", "enum": ["completed", "failed"] },
        "data_payload": { "type": "object" },
        "evidence_log_url": { "type": "string" }
      },
      "required": ["status", "data_payload"]
    }