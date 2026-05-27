{
  "envelope_id": "req-99283-abc",
  "timestamp": "2023-10-27T10:00:00Z",
  "repository": {
    "provider": "github",
    "owner": "666ghj",
    "name": "MiroFish",
    "full_url": "https://github.com/666ghj/MiroFish",
    "branch": "main"
  },
  "route": {
    "role": "code-executor-agent",
    "capabilities": ["read", "execute_test", "callback_evidence"],
    "stream_evidence": true
  },
  "runtime_prompt": "Task: Analyze the logic in MiroFish core and provide evidence of execution. \nContext: Repo https://github.com/666ghj/MiroFish",
  "execution_options": {
    "timeout": 300,
    "max_retries": 2,
    "evidence_level": "verbose"
  }
}