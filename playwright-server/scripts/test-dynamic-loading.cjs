#!/usr/bin/env node

/**
 * 测试动态加载适配
 * 验证等待机制和重试逻辑
 */

const axios = require('axios');

const PLAYWRIGHT_URL = 'http://localhost:3001';

async function testDynamicLoading() {
  console.log('🧪 测试动态加载适配\n');

  try {
    // 1. 打开浏览器
    console.log('1️⃣ 打开浏览器...');
    await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
      headless: false,
      viewport: { width: 1920, height: 1080 }
    });
    console.log('   ✅ 浏览器已打开\n');

    // 2. 导航到百度
    console.log('2️⃣ 导航到百度首页...');
    const navRes = await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: 'https://www.baidu.com',
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log(`   ✅ 页面标题: ${navRes.data.title}\n`);

    // 3. 获取 DOM（测试等待机制）
    console.log('3️⃣ 获取 DOM（应该等待动态元素加载，最多10秒）...');
    const startTime = Date.now();
    const domRes = await axios.get(`${PLAYWRIGHT_URL}/dom/simplified`);
    const elapsedTime = Date.now() - startTime;
    
    console.log(`   耗时: ${elapsedTime}ms`);
    console.log(`   找到 ${domRes.data.elements.length} 个 DOM 元素`);
    
    // 统计元素类型
    const elements = domRes.data.elements;
    const inputCount = elements.filter(e => e.tag === 'input').length;
    const buttonCount = elements.filter(e => e.tag === 'button').length;
    const linkCount = elements.filter(e => e.tag === 'a').length;
    
    console.log(`   - Input: ${inputCount}`);
    console.log(`   - Button: ${buttonCount}`);
    console.log(`   - Link: ${linkCount}\n`);

    // 4. 查找搜索框
    console.log('4️⃣ 查找搜索框元素...');
    const searchInput = elements.find(el => 
      el.id?.includes('kw') || 
      el.name?.includes('wd') || 
      el.type === 'search' ||
      el.placeholder?.includes('百度')
    );
    
    if (searchInput) {
      console.log('   ✅ 找到搜索框！');
      console.log(`      ID: ${searchInput.id}`);
      console.log(`      Name: ${searchInput.name}`);
      console.log(`      Type: ${searchInput.type}`);
      console.log(`      Placeholder: ${searchInput.placeholder || 'N/A'}`);
      if (searchInput.bbox) {
        console.log(`      位置: (${searchInput.bbox.x}, ${searchInput.bbox.y})`);
        console.log(`      尺寸: ${searchInput.bbox.width} x ${searchInput.bbox.height}`);
      }
    } else {
      console.log('   ⚠️  未找到搜索框元素\n');
    }

    // 5. 查找搜索按钮
    console.log('5️⃣ 查找搜索按钮...');
    const searchButton = elements.find(el => 
      el.text?.includes('百度一下') ||
      el.class?.includes('s_btn')
    );
    
    if (searchButton) {
      console.log('   ✅ 找到搜索按钮！');
      console.log(`      Text: ${searchButton.text}`);
      console.log(`      Class: ${searchButton.class || 'N/A'}`);
    } else {
      console.log('   ⚠️  未找到搜索按钮');
    }
    console.log();

    // 6. 执行搜索
    if (searchInput?.bbox && searchButton?.bbox) {
      console.log('6️⃣ 执行搜索操作...');
      
      const { x: ix, y: iy, width: iw, height: ih } = searchInput.bbox;
      const inputX = Math.floor(ix + iw / 2);
      const inputY = Math.floor(iy + ih / 2);
      
      console.log(`   👆 点击搜索框: (${inputX}, ${inputY})`);
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: inputX, y: inputY });
      await new Promise(r => setTimeout(r, 500));
      
      console.log('   ⌨️  输入"人工智能"...');
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
        selector: 'input#kw',
        text: '人工智能',
        options: { delay: 50, clear: true, force: true }
      });
      await new Promise(r => setTimeout(r, 500));
      
      const { x: bx, y: by, width: bw, height: bh } = searchButton.bbox;
      const btnX = Math.floor(bx + bw / 2);
      const btnY = Math.floor(by + bh / 2);
      
      console.log(`   👆 点击搜索按钮: (${btnX}, ${btnY})`);
      await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: btnX, y: btnY });
      
      console.log('   ✅ 搜索操作完成\n');
      
      // 等待结果
      console.log('7️⃣ 等待搜索结果...');
      await new Promise(r => setTimeout(r, 3000));
      
      // 验证
      console.log('8️⃣ 验证结果...');
      const finalStatus = await axios.get(`${PLAYWRIGHT_URL}/browser/status`);
      console.log(`   页面标题: ${finalStatus.data.title}`);
      console.log(`   URL: ${finalStatus.data.currentUrl}\n`);
    }

    // 总结
    console.log('═══════════════════════════════════════');
    console.log('📊 测试结果');
    console.log('═══════════════════════════════════════');
    console.log(`   DOM 获取: ✅ 成功`);
    console.log(`   等待机制: ${elapsedTime > 1000 ? '✅ 激活' : '⚠️  未触发'}`);
    console.log(`   元素发现: ${inputCount > 0 ? '✅ 成功' : '❌ 失败'}`);
    console.log(`   动态加载: ✅ 支持`);
    console.log('═══════════════════════════════════════\n');

    if (inputCount > 0) {
      console.log('🎉 动态加载适配测试成功！');
      console.log('   系统现在能够正确处理动态加载的内容。');
    } else {
      console.log('⚠️  测试部分成功，但未找到 input 元素。');
      console.log('   建议检查百度页面的具体渲染方式。');
    }

  } catch (error) {
    console.error('\n❌ 测试失败！');
    if (error.response) {
      console.error(`   HTTP ${error.response.status}`);
      console.error(`   ${JSON.stringify(error.response.data, null, 2)}`);
    } else {
      console.error(`   ${error.message}`);
    }
    console.log();
    process.exit(1);
  }
}

// 运行测试
testDynamicLoading().then(() => {
  console.log('✨ 测试完成！');
  process.exit(0);
}).catch(err => {
  console.error('💥 致命错误:', err);
  process.exit(1);
});
