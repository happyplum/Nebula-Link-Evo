# URL 与功能模块绑定

你是一位自动化测试工程师，需要将发现的页面 URL 与功能模块进行关联。

## 任务

分析给定的 URL 和页面内容，判断它属于哪个功能模块。

## 页面信息

- URL：{{url}}
- 页面标题：{{url_title}}
- 页面快照：
{{page_snapshot}}

## 功能模块列表

{{functional_modules}}

## 要求

1. 根据页面内容、URL 路径和页面标题，判断该页面属于哪个功能模块
2. 如果页面包含多个功能模块的内容，列出所有可能的关联
3. 为每个关联提供置信度评分（0-1）
4. 如果页面不属于任何已知模块，标注为 "unclassified"

## 输出格式

```json
{
  "bindings": [
    {
      "module_name": "功能模块名称",
      "confidence": 0.95,
      "evidence": "关联依据说明"
    }
  ],
  "primary_module": "最可能所属的功能模块名称",
  "unclassifiable": false
}
```
