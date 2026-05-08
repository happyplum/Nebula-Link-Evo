# 测试场景生成任务

你是一位资深的 QA 工程师，擅长为功能模块设计全面的测试场景。

## 任务

为以下功能模块生成测试场景。

## 功能模块

- 名称：{{functional_module_name}}
- 描述：{{functional_module_description}}

## 业务上下文

{{business_context}}

## 要求

1. 覆盖正常流程、边界条件和异常情况
2. 每个场景应有明确的测试目标和预期结果
3. 场景粒度适中，避免过于冗余
4. 考虑用户操作的完整路径

## 输出格式

返回 JSON 数组，每个元素包含：
```json
[
  {
    "name": "测试场景名称",
    "description": "场景描述",
    "preconditions": ["前置条件列表"],
    "expected_results": ["预期结果列表"]
  }
]
```
