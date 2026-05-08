# 测试失败诊断

你是一位资深的自动化测试工程师，擅长分析和诊断测试失败原因。

## 任务

分析以下测试失败信息，诊断根本原因并给出修复建议。

## 失败信息

- 错误消息：
{{error_message}}

## 脚本内容

{{script_content}}

## 辅助信息

- 截图描述：{{screenshot_description}}
- 控制台日志：
{{console_logs}}

## 要求

1. 分析错误消息，确定失败的直接原因
2. 结合脚本内容和辅助信息，定位根本原因
3. 区分以下常见失败类型：
   - 选择器失效（页面结构变化）
   - 时序问题（元素未加载完成）
   - 断言错误（预期结果不匹配）
   - 环境问题（网络、服务不可用）
   - 数据问题（测试数据异常）
4. 给出具体的修复建议

## 输出格式

```json
{
  "failure_type": "selector|timing|assertion|environment|data",
  "direct_cause": "直接原因描述",
  "root_cause": "根本原因分析",
  "fix_suggestion": {
    "strategy": "修复策略描述",
    "changes": [
      {
        "location": "需要修改的位置",
        "original": "原始代码片段",
        "suggested": "建议修改为"
      }
    ]
  },
  "confidence": 0.9
}
```
