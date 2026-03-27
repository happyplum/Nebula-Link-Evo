/**
 * 性能基线测试脚本 (F4) - 最终版本
 */

import { interactionLogger } from '../services/interaction-logger.js';
import { DatabaseManager } from '../conversation/db.js';
import type { CreateInteractionParams } from '../conversation/types.js';
import type { DOMElement } from '../types.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';


const PLAYWRIGHT_URL = 'http://localhost:3001';

interface ClickTestResult {
  latencyMs: number;
  success: boolean;
  strategy: string;
  elementId?: string;
  errorMessage?: string;
}




function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPerformanceTest(): Promise<void> {
  console.log('=== F4 性能基线测试开始 ===\n');
  
  const results: ClickTestResult[] = [];
  const testUrl = 'http://example.com';
  let snapshotId = '';
  
  try {
    // 初始化数据库
    console.log('[0/6] 初始化数据库...');
    const dbManager = DatabaseManager.getInstance();
    dbManager.initialize(); // 显式初始化
    console.log('✓ 数据库已初始化\n');
    
    // 1. 打开浏览器
    console.log('[1/6] 打开浏览器...');
    await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
      headless: false,
      viewport: { width: 1920, height: 1080 },
    });
    console.log('✓ 浏览器已打开');
    
    // 2. 导航到测试页面
    console.log('[2/6] 导航到测试页面...');
    await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: testUrl,
      waitUntil: 'networkidle',
    });
    await sleep(3000);
    console.log(`✓ 已导航到：${testUrl}\n`);
    
    // 3. 获取初始 snapshot
    console.log('[3/6] 获取页面 snapshot...');
    const domResponse = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
    snapshotId = domResponse.data.snapshot_id;
    console.log(`✓ Snapshot ID: ${snapshotId}`);
    
    // elements_map 是对象，转换为数组
    const elementsMapObj = domResponse.data.elements_map || {};
    const elementsMap: DOMElement[] = Object.values(elementsMapObj);
    console.log(`✓ 可交互元素数量：${elementsMap.length}\n`);
    
    // 4. 执行点击延迟测试
    console.log('[4/6] 执行点击延迟测试 (50 次)...');
    const iterations = 50;
    
    for (let i = 0; i < iterations; i++) {
      const startTime = Date.now();
      
      try {
        // 每 10 次重新获取 snapshot
        if (i % 10 === 0 && i > 0) {
          const freshDom = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
          snapshotId = freshDom.data.snapshot_id;
          const freshElementsObj = freshDom.data.elements_map as Record<string, DOMElement> | {};
          elementsMap.splice(0, elementsMap.length, ...Object.values(freshElementsObj));
          elementsMap.splice(0, elementsMap.length, ...Object.values(freshElementsObj));
          console.log(`  [刷新 snapshot，元素数量：${elementsMap.length}]`);
        }
        
        if (elementsMap.length === 0) {
          results.push({
            latencyMs: Date.now() - startTime,
            success: false,
            strategy: 'none',
            errorMessage: 'No elements',
          });
          console.log(`  [${i + 1}/${iterations}] 失败：无可交互元素`);
          continue;
        }

        // 随机选择一个元素
        const targetIndex = Math.floor(Math.random() * elementsMap.length);
        const target = elementsMap[targetIndex];
        
        if (!target || !target.bbox) {
          results.push({
            latencyMs: Date.now() - startTime,
            success: false,
            strategy: 'none',
            errorMessage: 'Invalid element',
          });
          console.log(`  [${i + 1}/${iterations}] 失败：元素无效`);
          continue;
        }

        const x = target.bbox.x + target.bbox.width / 2;
        const y = target.bbox.y + target.bbox.height / 2;

        // 使用坐标点击 (更可靠)
        await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x, y });
        
        const latency = Date.now() - startTime;
        
        results.push({
          latencyMs: latency,
          success: true,
          strategy: 'coordinates',
          elementId: target.id,
        });
        
        console.log(`  [${i + 1}/${iterations}] 成功 ${latency}ms`);
      } catch (error) {
        const latency = Date.now() - startTime;
        results.push({
          latencyMs: latency,
          success: false,
          strategy: 'error',
          errorMessage: (error as Error).message,
        });
        console.error(`  [${i + 1}/${iterations}] 失败：${(error as Error).message}`);
      }
      
      await sleep(200);
    }
    
    // 5. 计算点击性能指标
    const successful = results.filter((r) => r.success);
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const successRate = successful.length / results.length;
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
    const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    
    console.log('\n点击性能指标:');
    console.log(`  成功率：${(successRate * 100).toFixed(2)}% (${successful.length}/${results.length})`);
    console.log(`  P50: ${p50.toFixed(2)}ms`);
    console.log(`  P95: ${p95.toFixed(2)}ms`);
    console.log(`  P99: ${p99.toFixed(2)}ms`);
    console.log(`  平均：${avgLatency.toFixed(2)}ms`);
    
    // 6. 数据库性能测试
    console.log('\n[5/6] 执行数据库性能测试...');
    
    const logLatencies: number[] = [];
    const logCalls = 200;
    
    console.log(`  测试 ${logCalls} 次 log() 调用...`);
    for (let i = 0; i < logCalls; i++) {
      const startTime = performance.now();
      
      const testParams: CreateInteractionParams = {
        action_type: 'click',
        target_type: 'coordinates',
        locator_strategy: 'coordinates',
        success: true,
        attempts: 1,
        latency_ms: Math.random() * 100,
        snapshot_id: `test-${i}`,
        nebula_id: i,
      };
      
      await interactionLogger.log(testParams);
      const latency = performance.now() - startTime;
      logLatencies.push(latency);
    }
    
    await interactionLogger.flush();
    await sleep(500);
    
    // 测试查询性能
    console.log('  测试查询性能...');
    const queryLatencies: number[] = [];
    
    for (let i = 0; i < 50; i++) {
      const startTime = performance.now();
      dbManager.queryInteractions({ limit: 10, offset: i * 10 });
      const latency = performance.now() - startTime;
      queryLatencies.push(latency);
    }
    
    const avgLogLatency = logLatencies.length > 0 ? logLatencies.reduce((a, b) => a + b, 0) / logCalls : 0;
    const maxQueryTime = queryLatencies.length > 0 ? Math.max(...queryLatencies) : 0;
    
    console.log('\n数据库性能指标:');
    console.log(`  log() 平均延迟：${avgLogLatency.toFixed(3)}ms`);
    console.log(`  查询最大延迟：${maxQueryTime.toFixed(2)}ms`);
    
    // 7. 生成报告
    console.log('\n[6/6] 生成性能报告...');
    
    const p95Pass = p95 < 1200;
    const successRatePass = successRate >= 0.95;
    const dbLogPass = avgLogLatency < 1;
    const dbQueryPass = maxQueryTime < 100;
    const allPass = p95Pass && successRatePass && dbLogPass && dbQueryPass;
    
    const strategyDistribution = results.reduce((acc, r) => {
      acc[r.strategy] = (acc[r.strategy] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const report = `# F4 性能基线测试报告

**生成时间:** ${new Date().toISOString()}
**测试 URL:** ${testUrl}
**整体状态:** ${allPass ? '✅ 通过' : '❌ 未通过'}

## 1. 点击性能测试

### 测试概要
- 总测试次数：${results.length}
- 成功次数：${successful.length}
- 失败次数：${results.length - successful.length}
- **成功率:** ${(successRate * 100).toFixed(2)}% ${successRatePass ? '✅' : '❌'} (目标 ≥ 95%)

### 延迟分布
| 指标 | 数值 | 目标 | 状态 |
|------|------|------|------|
| P50 (中位数) | ${p50.toFixed(2)}ms | - | - |
| P95 | ${p95.toFixed(2)}ms | < 1200ms | ${p95Pass ? '✅' : '❌'} |
| P99 | ${p99.toFixed(2)}ms | - | - |
| 平均延迟 | ${avgLatency.toFixed(2)}ms | - | - |
| 最小延迟 | ${(latencies[0] ?? 0).toFixed(2)}ms | - | - |
| 最大延迟 | ${(latencies[latencies.length - 1] ?? 0).toFixed(2)}ms | - | - |

### 策略分布
| 策略 | 使用次数 | 占比 |
|------|----------|------|
${Object.entries(strategyDistribution)
  .map(([strategy, count]) => `| ${strategy} | ${count} | ${((count / results.length) * 100).toFixed(2)}% |`)
  .join('\n')}

## 2. 数据库性能测试

### Log() 调用性能 (${logCalls} 次)
| 指标 | 数值 | 目标 | 状态 |
|------|------|------|------|
| 平均延迟 | ${avgLogLatency.toFixed(3)}ms | < 1ms | ${dbLogPass ? '✅' : '❌'} |
| 最小延迟 | ${(Math.min(...logLatencies) || 0).toFixed(3)}ms | - | - |
| 最大延迟 | ${(Math.max(...logLatencies) || 0).toFixed(3)}ms | - | - |

### 查询性能 (50 次查询)
| 指标 | 数值 | 目标 | 状态 |
|------|------|------|------|
| 平均查询时间 | ${(queryLatencies.reduce((a, b) => a + b, 0) / queryLatencies.length).toFixed(2)}ms | - | - |
| 最大查询时间 | ${maxQueryTime.toFixed(2)}ms | < 100ms | ${dbQueryPass ? '✅' : '❌'} |
| 最小查询时间 | ${(Math.min(...queryLatencies) || 0).toFixed(2)}ms | - | - |

## 3. 测试结论

### 通过项
${p95Pass ? '- ✅ 点击延迟 P95 < 1.2s' : '- ❌ 点击延迟 P95 ≥ 1.2s'}
${successRatePass ? '- ✅ 点击成功率 ≥ 95%' : '- ❌ 点击成功率 < 95%'}
${dbLogPass ? '- ✅ 数据库 log() 平均延迟 < 1ms' : '- ❌ 数据库 log() 平均延迟 ≥ 1ms'}
${dbQueryPass ? '- ✅ 数据库查询最大延迟 < 100ms' : '- ❌ 数据库查询最大延迟 ≥ 100ms'}

### 改进建议
${p95Pass && successRatePass && dbLogPass && dbQueryPass 
  ? '- 所有性能指标均达标，无需优化' 
  : [
      p95Pass ? '' : '- 优化 AI 响应时间，考虑使用更快的模型',
      successRatePass ? '' : '- 改进元素定位策略，增加回退机制',
      dbLogPass ? '' : '- 优化批量写入逻辑，增加 batch size',
      dbQueryPass ? '' : '- 为常用查询字段添加索引',
    ].filter(Boolean).join('\n')
}

---
*报告生成于 ${new Date().toISOString()}*
`;

    const reportDir = join(process.cwd(), '.sisyphus', 'evidence');
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    
    const reportPath = join(reportDir, 'f4-performance-report.md');
    writeFileSync(reportPath, report, 'utf-8');
    
    console.log(`\n✓ 报告已保存到：${reportPath}`);
    console.log('\n=== 测试结果 ===');
    console.log(allPass ? '✅ 所有性能测试通过！' : '❌ 性能测试未通过！');
    
    if (!allPass) {
      if (!p95Pass) console.log(`  ❌ P95 (${p95.toFixed(2)}ms) ≥ 1200ms`);
      if (!successRatePass) console.log(`  ❌ 成功率 ${(successRate * 100).toFixed(2)}% < 95%`);
      if (!dbLogPass) console.log(`  ❌ log() 平均延迟 ${avgLogLatency.toFixed(3)}ms ≥ 1ms`);
      if (!dbQueryPass) console.log(`  ❌ 查询最大延迟 ${maxQueryTime.toFixed(2)}ms ≥ 100ms`);
    }
    
  } catch (error) {
    console.error('[PerformanceTest] 测试失败:', error);
    process.exit(1);
  } finally {
    console.log('\n清理浏览器...');
    try {
      await axios.post(`${PLAYWRIGHT_URL}/browser/close`, {}, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✓ 浏览器已关闭');
    } catch (e) {
      console.warn('关闭浏览器失败:', (e as Error).message);
    }
    console.log('测试完成');
  }
}

// 运行测试
runPerformanceTest().catch((error) => {
  console.error('[PerformanceTest] Fatal error:', error);
  process.exit(1);
});
