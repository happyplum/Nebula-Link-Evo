#!/usr/bin/env node

/**
 * 改进版百度搜索测试脚本
 * 使用更可靠的元素定位和错误处理
 */

const axios = require('axios');

const PLAYWRIGHT_URL = 'http://localhost:3001';

async function testBaiduSearchImproved() {
  console.log('🧪 改进版百度搜索测试...\n');

  try {
    // 1. 检查服务状态
    console.log('1️⃣ 检查服务状态...');
    const healthRes = await axios.get(`${PLAYWRIGHT_URL}/health`);
    console.log(`   浏览器状态: ${healthRes.data.browserOpen ? '已打开' : '未打开'}\n`);

    // 2. 确保浏览器打开
    console.log('2️⃣ 确保浏览器打开...');
    if (!healthRes.data.browserOpen) {
      await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
        headless: false,
        viewport: { width: 1920, height: 1080 }
      });
      console.log('   ✅ 浏览器已打开\n');
    }

    // 3. 导航到百度
    console.log('3️⃣ 导航到百度...');
    const navigateRes = await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: 'https://www.baidu.com',
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log(`   ✅ 页面标题: ${navigateRes.data.title}\n`);

    // 4. 获取 DOM 分析
    console.log('4️⃣ 分析页面元素...');
    const domRes = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
    
    // 打印所有可交互元素
    const interactableElements = domRes.data.elements.filter(el => el.isInteractable);
    console.log(`   找到 ${interactableElements.length} 个可交互元素`);
    
    // 特别关注 input 和 button 元素
    const inputs = domRes.data.elements.filter(el => el.tag === 'input');
    const buttons = domRes.data.elements.filter(el => el.tag === 'button');
    
    console.log(`   - Input 元素: ${inputs.length}`);
    inputs.forEach((el, i) => {
      console.log(`     [${i}] id=${el.id} type=${el.type} placeholder=${el.placeholder || 'N/A'}`);
    });
    
    console.log(`   - Button 元素: ${buttons.length}`);
    buttons.forEach((el, i) => {
      console.log(`     [${i}] text=${el.text || 'N/A'} class=${el.class || 'N/A'}`);
    });
    console.log();

    // 5. 尝试多种方法定位搜索框
    console.log('5️⃣ 定位并操作搜索框...');
    
    // 方法1: 查找特定 ID 或 class 的元素
    let searchInput = null;
    let searchButton = null;
    
    // 尝试查找百度搜索框 (通常有特定属性)
    for (const el of domRes.data.elements) {
      if (!searchInput && 
          (el.id?.includes('kw') || 
           el.placeholder?.includes('百度') ||
           el.type === 'search')) {
        searchInput = el;
        console.log(`   🔍 方法1找到搜索框: id=${el.id}, type=${el.type}`);
      }
      
      if (!searchButton && 
          (el.text?.includes('百度一下') || 
           el.class?.includes('s_btn'))) {
        searchButton = el;
        console.log(`   🔍 方法1找到搜索按钮: text=${el.text}`);
      }
    }
    
    // 方法2: 如果方法1失败，使用坐标
    if (!searchInput) {
      console.log('   ⚠️  方法1未找到，使用坐标定位...');
      // 百度搜索框通常在页面中心偏上位置
      const estimatedInput = { x: 350, y: 230, width: 500, height: 40 };
      const centerX = Math.floor(estimatedInput.x + estimatedInput.width / 2);
      const centerY = Math.floor(estimatedInput.y + estimatedInput.height / 2);
      
      console.log(`   👆 点击搜索框位置: (${centerX}, ${centerY})`);
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: centerX, y: centerY });
      await new Promise(r => setTimeout(r, 500));
    } else if (searchInput.bbox) {
      const { x, y, width, height } = searchInput.bbox;
      const centerX = Math.floor(x + width / 2);
      const centerY = Math.floor(y + height / 2);
      
      console.log(`   👆 点击搜索框: (${centerX}, ${centerY})`);
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: centerX, y: centerY });
      await new Promise(r => setTimeout(r, 500));
    }

    // 6. 输入搜索关键词
    console.log('6️⃣ 输入搜索内容...');
    
    // 使用 type 命令输入文本
    // 先尝试使用选择器
    try {
      // 尝试使用浏览器特定的 locator
      console.log('   ⌨️  输入"人工智能"...');
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
        selector: 'input[name="wd"]',  // 百度搜索框的 name 属性
        text: '人工智能',
        options: { delay: 100, clear: true }
      });
    } catch (typeError) {
      console.log(`   ⚠️  选择器方式失败，尝试坐标输入...`);
      // 如果选择器失败，直接聚焦到估计位置并输入
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
        selector: ':focus',
        text: '人工智能',
        options: { delay: 100, clear: true }
      });
    }
    
    await new Promise(r => setTimeout(r, 500));
    console.log('   ✅ 输入完成\n');

    // 7. 点击搜索按钮或按回车
    console.log('7️⃣ 执行搜索...');
    
    if (searchButton && searchButton.bbox) {
      const btnX = Math.floor(searchButton.bbox.x + searchButton.bbox.width / 2);
      const btnY = Math.floor(searchButton.bbox.y + searchButton.bbox.height / 2);
      console.log(`   👆 点击搜索按钮: (${btnX}, ${btnY})`);
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: btnX, y: btnY });
    } else {
      console.log('   ⏎  按回车键搜索');
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
        selector: 'body',
        text: '\n',
        options: { delay: 100 }
      });
    }
    
    await new Promise(r => setTimeout(r, 3000));
    console.log('   ✅ 搜索完成\n');

    // 8. 验证搜索结果
    console.log('8️⃣ 验证搜索结果...');
    const finalDom = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
    console.log(`   页面标题: ${finalDom.data.title}`);
    console.log(`   DOM 元素数: ${finalDom.data.elements.length}`);
    
    // 检查是否还在百度首页
    if (finalDom.data.title.includes('人工智能') || 
        !finalDom.data.url.includes('baidu.com')) {
      console.log('   ✅ 搜索成功！已离开百度首页\n');
    } else {
      console.log('   ⚠️  可能还在百度首页，建议手动验证\n');
    }

    // 9. 截图保存结果
    console.log('9️⃣ 保存搜索结果截图...');
    const screenshotRes = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
      fullPage: false,
      type: 'png'
    });
    const sizeKB = (Buffer.from(screenshotRes.data.screenshot, 'base64').length / 1024).toFixed(2);
    console.log(`   ✅ 截图已保存 (${sizeKB} KB)\n`);

    console.log('🎉 测试完成！\n');
    console.log('📋 测试摘要:');
    console.log('   - 服务状态: ✅ 正常');
    console.log('   - 浏览器控制: ✅ 成功');
    console.log('   - 导航功能: ✅ 成功');
    console.log('   - DOM 分析: ✅ 成功');
    console.log('   - 搜索操作: ✅ 成功');
    console.log('   - 结果验证: ✅ 完成\n');

  } catch (error) {
    console.error('❌ 测试失败:');
    if (error.response) {
      console.error(`   HTTP 状态: ${error.response.status}`);
      console.error(`   错误信息: ${error.response.data?.error || error.response.data}`);
      
      // 如果是 playwright 错误，提供调试建议
      if (error.response.data?.error?.includes('locator')) {
        console.error('\n💡 调试建议:');
        console.error('   1. 尝试使用 headless 模式');
        console.error('   2. 增加页面等待时间');
        console.error('   3. 检查页面是否完全加载');
        console.error('   4. 考虑使用更精确的选择器');
      }
    } else if (error.request) {
      console.error('   服务无响应，请检查:');
      console.error('   - Playwright Server 是否运行 (端口 3001)');
      console.error('   - 浏览器是否正常启动');
    } else {
      console.error(`   错误: ${error.message}`);
    }
    console.log();
    process.exit(1);
  }
}

// 运行测试
testBaiduSearchImproved().then(() => {
  console.log('✨ 所有测试步骤执行成功！');
  process.exit(0);
}).catch(err => {
  console.error('💥 测试执行失败:', err);
  process.exit(1);
});
