# check_config.py 的测试数据

跑回归测试：

```bash
python3 Tools/test_check_config.py
```

也可以单独把校验脚本指向任一套数据，手工看输出：

```bash
python3 Tools/check_config.py --dir Tools/testdata/broken
```

## 三套数据

| 目录 | 内容 | 期望结果 |
|---|---|---|
| `clean/` | 15 张表全部填好、全部合法、全部 `待核=否` | 开发与交付模式都 0 错误 0 警告 |
| `broken/` | 以 clean 为底覆盖 6 张表，**每一行针对一条校验规则** | 36 条断言逐条命中，退出码 1 |
| `partial/` | 只有 `terrains.csv` 与 `adjacency_rules.csv` | 0 错误，只有 13 条缺表警告 |

`partial/` 是一条**回归守卫**：它守的是「目标表缺失时不得因外键检查而爆错」这个行为。
而「一张一张生成表」正是 `parse_civ6_xml.py` 的实际工作方式，所以这条行为不能退化。

## 维护约定

- `broken/` 里每一行的「名称」列写的就是它要触发的错误，改数据时保持这个习惯
- **改了校验规则，就来 `test_check_config.py` 加一条断言**。否则下次改坏了没人知道
- 这三套数据是假数据，与文明 6 的真实数值无关（`clean/` 里的数字是编的）。
  它们只用来验证**校验逻辑**，不用来验证游戏规则
