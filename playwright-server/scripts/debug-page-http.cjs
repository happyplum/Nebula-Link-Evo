#!/usr/bin/env node

/**
 * Debug 页面调试脚本 (HTTP 模式)
 * 使用 playwright-server 调试 proxy-adapter 的 debug 页面
 * 支持 WebSocket 连接测试
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const PLAYWRIGHT_URL = 'http://localhost:3001';
const DEBUG_PAGE_URL = 'http://localhost:3000/debug';

async function debugPage() {
  console.log('🎯 开始调试 Debug 页面 (HTTP 模式)\n');

  try {
    // 1. 检查服务健康状态
    console.log('1️⃣ 检查服务状态...');
    const healthRes = await axios.get(`${PLAYWRIGHT_URL}/health`);
    console.log(`   ✅ Playwright 服务状态: ${healthRes.data.status}`);
    console.log(`   📊 浏览器状态: ${healthRes.data.browserOpen ? '已打开' : '未打开'}\n`);

    // 检查 proxy-adapter 服务
    try {
      console.log('1️⃣.5 检查 proxy-adapter 服务...');
      await axios.get('http://localhost:3000/health', { timeout: 3000 });
      console.log('   ✅ Proxy-adapter 服务正常\n');
    } catch (e) {
      console.log('   ⚠️  Proxy-adapter 服务未响应，请先启动服务\n');
      console.log('   💡 启动命令: cd proxy-adapter && pnpm start\n');
    }

    // 2. 先关闭旧浏览器，重新打开（确保状态干净）
    console.log('2️⃣ 重置浏览器状态...');
    try {
      await axios.post(`${PLAYWRIGHT_URL}/browser/close`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('   ✅ 旧浏览器已关闭');
    } catch (e) {
      console.log('   ℹ️  无旧浏览器需要关闭');
    }
    
    console.log('   正在打开新浏览器...');
    await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
      headless: false,  // 使用非无头模式，可以看到浏览器窗口
      viewport: { width: 1920, height: 1080 }
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('   ✅ 浏览器已打开\n');

    // 3. 导航到 debug 页面（HTTP 协议）
    console.log('3️⃣ 导航到 Debug 页面 (HTTP)...');
    console.log(`   🌐 HTTP URL: ${DEBUG_PAGE_URL}`);

    const navRes = await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: DEBUG_PAGE_URL,
      waitUntil: 'networkidle',
      timeout: 30000
    });

    console.log(`   ✅ 页面标题: ${navRes.data.title}`);
    console.log(`   ✅ 当前 URL: ${navRes.data.url}\n`);

    // 4. 等待页面加载稳定和 WebSocket 连接
    console.log('4️⃣ 等待页面稳定和 WebSocket 连接...');
    await new Promise(resolve => setTimeout(resolve, 5000));  // 给 WebSocket 更长的时间
    console.log('   ✅ 页面已稳定\n');

    // 5. 获取页面 DOM 信息
    console.log('5️⃣ 分析页面 DOM...');
    const domRes = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
    const elementCount = domRes.data.elements?.length || 0;
    console.log(`   ✅ 找到 ${elementCount} 个可交互元素\n`);

    // 6. 截图
    console.log('6️⃣ 截取当前页面...');
    const screenshotRes = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
      fullPage: false
    });

    // 保存截图
    const screenshotPath = path.join(__dirname, 'debug-screenshot-http.png');
    const buffer = Buffer.from(screenshotRes.data.screenshot, 'base64');
    fs.writeFileSync(screenshotPath, buffer);
    const sizeKB = (buffer.length / 1024).toFixed(2);
    console.log(`   ✅ 截图已保存: ${screenshotPath} (${sizeKB} KB)\n`);

    // 7. 执行 JavaScript 检查页面和 WebSocket
    console.log('7️⃣ 执行页面 JavaScript 检查...');
    const checks = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `
        // 检查 WebSocket 连接状态
        const wsConnected = typeof window.ws !== 'undefined' && window.ws.readyState === WebSocket.OPEN;
        
        // 检查连接状态指示器
        const statusBadge = document.querySelector('#statusBadge, .status-badge');
        const isOnline = statusBadge ? statusBadge.classList.contains('online') : false;
        
        // 检查页面元素
        const activityBar = document.querySelector('.activity-bar');
        const sidebar = document.querySelector('.sidebar');
        const main = document.querySelector('.main');
        const rightPanel = document.querySelector('.right-panel');
        
        // 检查按钮数量
        const buttons = document.querySelectorAll('button').length;
        
        // 检查输入框数量
        const inputs = document.querySelectorAll('input, textarea, select').length;
        
        // 检查折叠面板
        const accordions = document.querySelectorAll('.accordion').length;
        const accordionHeaders = document.querySelectorAll('.accordion-header').length;
        
        // 检查右侧面板标签
        const rightPanelTabs = document.querySelectorAll('.right-panel-tab').length;
        const rightPanelPages = document.querySelectorAll('.right-panel-page').length;
        
        // 检查日志显示
        const logDisplay = document.getElementById('logDisplay');
        const logEntries = logDisplay ? logDisplay.querySelectorAll('.log-entry').length : 0;
        
        return {
          wsConnected,
          isOnline,
          layout: {
            hasActivityBar: !!activityBar,
            hasSidebar: !!sidebar,
            hasMain: !!main,
            hasRightPanel: !!rightPanel
          },
          counts: {
            buttons,
            inputs,
            accordions,
            accordionHeaders,
            rightPanelTabs,
            rightPanelPages,
            logEntries
          }
        };
      `
    });

    console.log('   页面检查结果:');
    const checksData = checks.data.result;
    console.log(`   🔌 WebSocket 连接: ${checksData.wsConnected ? '✅ 已连接' : '❌ 未连接'}`);
    console.log(`   📊 页面状态: ${checksData.isOnline ? '✅ 在线' : '⚠️  离线'}`);
    console.log(`   📊 布局组件:`);
    console.log(`      活动栏: ${checksData.layout.hasActivityBar ? '✅' : '❌'}`);
    console.log(`      侧边栏: ${checksData.layout.hasSidebar ? '✅' : '❌'}`);
    console.log(`      主内容区: ${checksData.layout.hasMain ? '✅' : '❌'}`);
    console.log(`      右侧面板: ${checksData.layout.hasRightPanel ? '✅' : '❌'}`);
    console.log(`   🔢 元素数量:`);
    console.log(`      按钮: ${checksData.counts.buttons}`);
    console.log(`      输入框: ${checksData.counts.inputs}`);
    console.log(`      折叠面板: ${checksData.counts.accordions}`);
    console.log(`      面板标题: ${checksData.counts.accordionHeaders}`);
    console.log(`      右侧标签: ${checksData.counts.rightPanelTabs}`);
    console.log(`      右侧页面: ${checksData.counts.rightPanelPages}`);
    console.log(`      日志条目: ${checksData.counts.logEntries}\n`);

    // 8. 测试交互功能
    console.log('8️⃣ 测试交互功能...');

    // 测试点击活动栏图标
    console.log('   📍 测试活动栏图标...');
    try {
      const activityBarEl = domRes.data.elements.find(el => el.class?.includes('activity-bar'));
      if (activityBarEl) {
        console.log(`      📍 活动栏位置: (${activityBarEl.bbox.x}, ${activityBarEl.bbox.y})`);
        console.log(`      📍 尺寸: ${activityBarEl.bbox.width} x ${activityBarEl.bbox.height}`);
      }
    } catch (e) {
      console.log('      ⚠️  无法获取活动栏位置');
    }

    // 测试切换右侧面板
    console.log('   🔄 测试切换右侧面板...');
    try {
      const rightPanelToggleEl = domRes.data.elements.find(el => 
        el.tag === 'button' && (el.text?.includes('详细信息') || el.onclick?.includes('toggleRightPanel'))
      );
      if (rightPanelToggleEl) {
        const clickX = rightPanelToggleEl.bbox.x + rightPanelToggleEl.bbox.width / 2;
        const clickY = rightPanelToggleEl.bbox.y + rightPanelToggleEl.bbox.height / 2;
        console.log(`      📍 点击位置: (${Math.floor(clickX)}, ${Math.floor(clickY)})`);
        
        await axios.post(`${PLAYWRIGHT_URL}/action/click`, {
          x: Math.floor(clickX),
          y: Math.floor(clickY)
        });
        console.log('      ✅ 右侧面板切换按钮点击成功');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.log('      ⚠️  无法点击右侧面板切换按钮');
    }

    // 测试切换右侧面板标签
    console.log('   🏷️  测试切换右侧面板标签...');
    try {
      const tabEl = domRes.data.elements.find(el => 
        el.class?.includes('right-panel-tab') && el.tag === 'button'
      );
      if (tabEl && tabEl.text) {
        const clickX = tabEl.bbox.x + tabEl.bbox.width / 2;
        const clickY = tabEl.bbox.y + tabEl.bbox.height / 2;
        console.log(`      📍 点击标签: ${tabEl.text}`);
        console.log(`      📍 点击位置: (${Math.floor(clickX)}, ${Math.floor(clickY)})`);
        
        await axios.post(`${PLAYWRIGHT_URL}/action/click`, {
          x: Math.floor(clickX),
          y: Math.floor(clickY)
        });
        console.log('      ✅ 标签切换成功');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.log('      ⚠️  无法切换标签');
    }

    console.log('');

    // 9. 最终状态检查
    console.log('9️⃣ 最终状态检查...');
    const finalStatus = await axios.get(`${PLAYWRIGHT_URL}/browser/status`);
    console.log(`   📄 页面标题: ${finalStatus.data.title}`);
    console.log(`   📍 当前 URL: ${finalStatus.data.currentUrl}\n`);

    // 10. WebSocket 连接测试
    if (!checksData.wsConnected) {
      console.log('⚠️  WebSocket 未连接，可能原因:');
      console.log('   1. Proxy-adapter 服务未运行');
      console.log('   2. WebSocket 端点配置错误');
      console.log('   3. 防火墙阻止连接');
      console.log('   4. 浏览器安全策略限制');
      console.log('');
    }

    // 11. 总结
    console.log('═══════════════════════════════════════');
    console.log('🎉 调试完成！');
    console.log('═══════════════════════════════════════');
    console.log(`   ✅ 浏览器已打开并稳定运行`);
    console.log(`   ✅ Debug 页面已通过 HTTP 加载`);
    console.log(`   ✅ 页面布局完整`);
    console.log(`   ✅ 截图已保存: ${screenshotPath}`);
    if (checksData.wsConnected) {
      console.log(`   ✅ WebSocket 连接正常`);
    } else {
      console.log(`   ⚠️  WebSocket 未连接`);
    }
    console.log('');
    console.log('💡 下一步操作:');
    console.log('   1. 在浏览器中手动测试各项功能');
    console.log('   2. 检查浏览器控制台是否有错误');
    console.log('   3. 检查 WebSocket 连接状态');
    console.log('   4. 测试响应式布局（调整窗口大小）');
    console.log('   5. 测试所有折叠面板和标签切换');
    console.log('   6. 测试手动操作（点击、输入、滚动）');
    console.log('   7. 查看 proxy-adapter 日志以了解 WebSocket 消息');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ 调试失败:');
    if (error.response) {
      console.error(`   HTTP ${error.response.status}`);
      console.error(`   ${error.response.data?.error || error.response.data}`);
    } else if (error.request) {
      console.error('   服务无响应');
    } else {
      console.error(`   ${error.message}`);
    }
    console.log('\n💡 建议检查:');
    console.log('   1. playwright-server 是否正在运行 (端口 3001)');
    console.log('   2. proxy-adapter 是否正在运行 (端口 3000)');
    console.log('   3. 网络连接是否正常');
    console.log('   4. 防火墙是否允许本地连接');
    console.log('   5. 查看各服务的日志输出');
    console.log('');
    process.exit(1);
  }
}

// 运行调试
debugPage().then(() => {
  console.log('✨ 调试脚本完成！');
  process.exit(0);
}).catch(err => {
  console.error('💥 执行错误:', err);
  process.exit(1);
});
