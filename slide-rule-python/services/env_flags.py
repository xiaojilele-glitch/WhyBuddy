# -*- coding: utf-8 -*-
"""转出层：真身在 `config/env_flags.py`。

## 为什么搬到 config（2026-08-29）

`sliderule_llm.config` 与 `sliderule_llm.gateway_circuit` 都要读布尔开关，而这个
模块原来住在 `services` 里——于是 **LLM 通道层反过来依赖业务层**，方向是反的
（`architecture.toml` 里 `sliderule_llm` 只声明了 `config` / `models`）。
两处只好把 import 藏进函数体绕开。

它本来就该在下层：**读环境变量是配置，不是业务**。抄 grok 的叶子 crate——
共用叶子放在谁都能依赖的位置，方向自然就顺了，不需要任何倒置或例外。

## 这个文件为什么留着

仓里 28 个调用点按 `services.env_flags` 引用它，判据也钉在这个名字上
（`tests/test_env_flags.py`）。**搬家只该改依赖方向，不该把别人的调用点弄红。**
新代码请直接 `from config.env_flags import flag`。
"""

from config.env_flags import (  # noqa: F401
    OFF,
    ON,
    flag,
    off_values,
    on_values,
    parse,
    reset_shouted,
)
