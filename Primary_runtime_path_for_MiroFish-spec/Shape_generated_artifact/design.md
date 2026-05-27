{
  "artifact_id": "UUID",
  "metadata": {
    "source_agent": "Role-Agent-ID",
    "timestamp": "ISO-8601",
    "version": "1.0"
  },
  "root_scope": {
    "context": "任务宏观背景描述",
    "objective": "最终目标定义"
  },
  "nodes": [
    {
      "node_id": "N1",
      "label": "节点名称",
      "description": "节点功能描述",
      "priority": 1,
      "status": "completed/failed/skipped"
    }
  ],
  "route_coverage": {
    "primary_route": {
      "route_id": "R1",
      "steps": ["Step1", "Step2", "Step3"],
      "completed_steps": ["Step1", "Step2"]
    },
    "alternative_routes": [
      {
        "route_id": "R1-Alt",
        "condition": "Condition logic",
        "covered": true
      }
    ]
  },
  "evidence": {
    "callbacks": [
      {
        "step_id": "Step1",
        "data_payload": {},
        "log_ref": "path/to/live_log"
      }
    ],
    "validation_proof": "Base64 or Link to result"
  }
}