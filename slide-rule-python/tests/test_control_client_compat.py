from sliderule_llm.control_client import _extract_control


def test_extract_control_accepts_legacy_singular_function_call():
    content, calls, usage, finish = _extract_control(
        {
            "model": "compat",
            "choices": [
                {
                    "finish_reason": "function_call",
                    "message": {
                        "content": "",
                        "function_call": {
                            "name": "ask_user_question",
                            "arguments": '{"questions": [{"question": "设备？", "options": [{"label": "桌面端"}]}]}',
                        },
                    },
                }
            ],
            "usage": {"total_tokens": 3},
        }
    )
    assert content == ""
    assert calls[0]["name"] == "ask_user_question"
    assert calls[0]["arguments"]["questions"][0]["options"][0]["label"] == "桌面端"
    assert usage == {"total_tokens": 3}
    assert finish == "function_call"


def test_extract_control_keeps_empty_response_empty_when_no_call():
    content, calls, _usage, _finish = _extract_control(
        {"choices": [{"message": {"content": ""}}]}
    )
    assert content == ""
    assert calls == []
