#!/usr/bin/env node

/**
 * 百度搜索测试脚本
 * 测试 playwright-server 的搜索功能
 */

const axios = require('axios');

const PLAYWRIGHT_URL = 'http://localhost:3001';

async function testBaiduSearch() {
  console.log('🧪 开始测试百度搜索功能...\n');

  try {
    // 1. 检查服务健康状态
    console.log('1️⃣ 检查服务状态...');
    const healthRes = await axios.get(`${PLAYWRIGHT_URL}/health`);
    console.log(`   健康状态: ${healthRes.data.status}`);
    console.log(`   浏览器打开: ${healthRes.data.browserOpen}\n`);

    // 2. 打开浏览器
    console.log('2️⃣ 打开浏览器...');
    if (!healthRes.data.browserOpen) {
      await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
        headless: false,
        viewport: { width: 1920, height: 1080 }
      });
      console.log('   ✅ 浏览器已打开\n');
    } else {
      console.log('   ℹ️  浏览器已经打开\n');
    }

    // 3. 导航到百度
    console.log('3️⃣ 导航到百度...');
    const navigateRes = await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: 'https://www.baidu.com',
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log(`   ✅ 已导航到: ${navigateRes.data.url}`);
    console.log(`   页面标题: ${navigateRes.data.title}\n`);

    // 4. 截图
    console.log('4️⃣ 截图...');
    const screenshotRes = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
      fullPage: false,
      type: 'png'
    });
    const screenshotSize = Buffer.from(screenshotRes.data.screenshot, 'base64').length;
    console.log(`   ✅ 截图成功 (${(screenshotSize / 1024).toFixed(2)} KB)\n`);

    // 5. 获取 DOM 树
    console.log('5️⃣ 获取 DOM 树...');
    const domRes = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
    console.log(`   ✅ 获取到 ${domRes.data.elements.length} 个 DOM 元素`);
    
    // 查找搜索框
    const searchInput = domRes.data.elements.find(el => 
      el.tag === 'input' && 
      (el.type === 'search' || el.type === 'text' || el.placeholder?.includes('请输入'))
    );
    
    if (searchInput) {
      console.log(`   🔍 找到搜索框:`);
      console.log(`      - 标签: ${searchInput.tag}`);
      console.log(`      - 类型: ${searchInput.type}`);
      console.log(`      - 占位符: ${searchInput.placeholder}`);
      console.log(`      - 位置: (${searchInput.bbox?.x}, ${searchInput.bbox?.y})`);
      console.log(`      - 尺寸: ${searchInput.bbox?.width} x ${searchInput.bbox?.height}\n`);
    } else {
      console.log('   ⚠️  未找到明显的搜索框元素\n');
    }

    // 6. 模拟搜索操作
    console.log('6️⃣ 执行搜索操作...');
    
    // 如果找到了搜索框元素，使用点击和输入
    if (searchInput?.bbox) {
      const { x, y, width, height } = searchInput.bbox;
      const centerX = Math.floor(x + width / 2);
      const centerY = Math.floor(y + height / 2);

      // 点击搜索框
      console.log(`   👆 点击搜索框中心坐标: (${centerX}, ${centerY})`);
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: centerX, y: centerY });
      await new Promise(r => setTimeout(r, 500));

      // 输入文本
      console.log(`   ⌨️  输入搜索关键词: "人工智能"`);
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, { 
        selector: ':focus',
        text: '人工智能',
        options: { delay: 50, clear: true }
      });
      await new Promise(r => setTimeout(r, 500));

      // 按回车搜索
      console.log('   ⏎  按回车键搜索');
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, { 
        selector: ':focus', 
        text: '\n',
        options: { delay: 50 }
      });
      
      console.log('   ✅ 搜索操作完成\n');

      // 等待搜索结果加载
      console.log('7️⃣ 等待搜索结果...');
      await new Promise(r => setTimeout(r, 3000));

      // 截图验证
      console.log('8️⃣ 验证搜索结果...');
      const resultScreenshot = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
        fullPage: false,
        type: 'png'
      });
      const resultSize = Buffer.from(resultScreenshot.data.screenshot, 'base64').length;
      console.log(`   ✅ 搜索结果截图 (${(resultSize / 1024).toFixed(2)} KB)\n`);
    } else {
      // 如果没找到搜索框，尝试使用坐标点击
      console.log('   ⚠️  未找到搜索框，尝试使用备用方法...');
      console.log('   👆 点击搜索框预估位置: (960, 540)');
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: 960, y: 540 });
      await new Promise(r => setTimeout(r, 500));
      
      console.log('   ⌨️  输入搜索关键词: "人工智能"');
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, { 
        selector: 'body',
        text: '人工智能',
        options: { delay: 50, clear: true }
      });
    }

    console.log('✅ 测试完成！\n');

  } catch (error) {
    console.error('❌ 测试失败:');
    if (error.response) {
      console.error(`   状态码: ${error.response.status}`);
      console.error(`   数据: ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error.request) {
      console.error('   请求已发送但没有收到响应');
      console.error('   请确保服务正在运行:');
      console.error('   - Playwright Server: http://localhost:3001');
      console.error('   - Proxy Adapter: http://localhost:3000');
    } else {
      console.error(`   错误: ${error.message}`);
    }
    process.exit(1);
  }
}

// 运行测试
testBaiduSearch().then(() => {
  console.log('🎉 所有测试步骤执行成功！');
  process.exit(0);
}).catch(err => {
  console.error('💥 测试脚本执行失败:', err);
  process.exit(1);
});
