# 日历导航演示

这个演示只改变 Calendar 的视图或浏览月份，不创建、编辑、发送或删除日程。

## 建议阶段

| 阶段 | Jev 目标 | 可观察成功证据 |
| --- | --- | --- |
| 月视图 | `Switch Calendar to Month view.` | `month-button` 的选中状态为真 |
| 上个月 | `Navigate to the month immediately before the observed month.` | 月份标题等于起始月份的前一个月 |
| 今天 | `Return Calendar to today.` | 标题与本地当前年月一致，且今天被选中 |

每个阶段单独完成“观察 → `jev_candidates` → `jev_decide` → 一个 Computer Use 动作 → 新观察核验”。候选角色使用 MCP 返回的规范英文值，例如 `radio button`；标签可以是英文或中文。

从真实起始状态计算预期年月，不硬编码示例日期或 AX 索引。若 AX 无法可靠表达选中状态，停止自动循环并由 Codex 读取当前界面核验；仍然不要把截图发送给 Jev。

每阶段最多尝试 2–3 步。出现弹窗、用户改变界面、策略返回非 `proceed`，或连续两次没有进展时停止。
