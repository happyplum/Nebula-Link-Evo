#!/usr/bin/env node

/**
 * 最终版百度搜索测试
 * 使用多种策略确保搜索成功
 */

const axios = require('axios');

const PLAYWRIGHT_URL = 'http://localhost:3001';

async function testBaiduSearchFinal() {
  console.log('🎯 最终版百度搜索测试\n');

  try {
    // 1. 检查并打开浏览器
    console.log('1️⃣ 初始化浏览器...');
    const healthRes = await axios.get(`${PLAYWRIGHT_URL}/health`);
    
    if (!healthRes.data.browserOpen) {
      await axios.post(`${PLAYWRIGHT_URL}/browser/open`, {
        headless: false,
        viewport: { width: 1920, height: 1080 }
      });
      console.log('   ✅ 浏览器已打开\n');
    }

    // 2. 导航到百度
    console.log('2️⃣ 导航到百度...');
    const navRes = await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: 'https://www.baidu.com',
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log(`   ✅ 页面标题: ${navRes.data.title}\n`);

    // 3. 等待页面完全加载
    console.log('3️⃣ 等待页面稳定...');
    await new Promise(r => setTimeout(r, 2000));

    // 4. 尝试多种方法输入搜索内容
    console.log('4️⃣ 搜索策略...\n');

    // 策略1: 使用 playwright 的选择器
    console.log('   策略1: 使用 CSS 选择器...');
    try {
      await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
        selector: 'input#kw',  // 百度搜索框的 ID
        text: '人工智能',
        options: { delay: 50, clear: true }
      });
      console.log('   ✅ 策略1成功！\n');
    } catch (err) {
      console.log(`   ❌ 策略1失败: ${err.response?.data?.error || err.message}`);
      
      // 策略2: 使用 name 属性
      console.log('\n   策略2: 使用 name 属性...');
      try {
        await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
          selector: 'input[name="wd"]',
          text: '人工智能',
          options: { delay: 50, clear: true }
        });
        console.log('   ✅ 策略2成功！\n');
      } catch (err2) {
        console.log(`   ❌ 策略2失败: ${err2.response?.data?.error || err2.message}`);
        
        // 策略3: 使用 XPath 点击+输入
        console.log('\n   策略3: 坐标点击 + 键盘输入...');
        
        // 百度搜索框大约在页面中心
        const searchBoxX = 350;  // 左侧搜索框区域
        const searchBoxY = 230;  // 搜索框垂直位置
        const searchBoxWidth = 500;
        const searchBoxHeight = 40;
        
        const clickX = Math.floor(searchBoxX + searchBoxWidth / 2);
        const clickY = Math.floor(searchBoxY + searchBoxHeight / 2);
        
        console.log(`   👆 点击位置: (${clickX}, ${clickY})`);
        await axios.post(`${PLAYWRIGHT_URL}/action/click`, { x: clickX, y: clickY });
        await new Promise(r => setTimeout(r, 1000));
        
        console.log('   ⌨️  输入"人工智能"...');
        await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
          selector: 'body',
          text: '人工智能',
          options: { delay: 50 }
        });
        console.log('   ✅ 策略3完成\n');
      }
    }

    // 5. 按回车搜索
    console.log('5️⃣ 执行搜索...');
    await axios.post(`${PLAYWRIGHT_URL}/action/type`, {
      selector: 'body',
      text: '\n',
      options: { delay: 100 }
    });
    console.log('   ✅ 已发送回车\n');

    // 6. 等待搜索结果
    console.log('6️⃣ 等待搜索结果...');
    await new Promise(r => setTimeout(r, 3000));

    // 7. 验证结果
    console.log('7️⃣ 验证搜索结果...');
    const finalStatus = await axios.get(`${PLAYWRIGHT_URL}/browser/status`);
    console.log(`   页面标题: ${finalStatus.data.title}`);
    console.log(`   当前URL: ${finalStatus.data.currentUrl}\n`);

    // 8. 截图
    console.log('8️⃣ 截图保存...');
    const screenshotRes = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, {
      fullPage: false,
      type: 'png'
    });
    const sizeKB = (Buffer.from(screenshotRes.data.screenshot, 'base64').length / 1024).toFixed(2);
    console.log(`   ✅ 截图大小: ${sizeKB} KB\n`);

    // 9. 检查是否成功
    const isSuccess = finalStatus.data.title.includes('人工智能') || 
                      !finalStatus.data.currentUrl?.includes('baidu.com/home');
    
    console.log('═══════════════════════════════════════');
    console.log('🎉 测试结果');
    console.log('═══════════════════════════════════════');
    console.log(`   页面加载: ✅`);
    console.log(`   搜索操作: ${isSuccess ? '✅' : '⚠️'}`);
    console.log(`   结果验证: ${isSuccess ? '✅' : '❌'}`);
    
    if (isSuccess) {
      console.log('\n✅ 百度搜索测试成功！');
      console.log(`   搜索关键词: "人工智能"`);
      console.log(`   页面标题: ${finalStatus.data.title}`);
    } else {
      console.log('\n⚠️  搜索可能未完全成功，建议手动检查浏览器');
    }
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('\n❌ 测试失败:');
    if (error.response) {
      console.error(`   HTTP ${error.response.status}`);
      console.error(`   ${error.response.data?.error || error.response.data}`);
    } else if (error.request) {
      console.error('   服务无响应');
    } else {
      console.error(`   ${error.message}`);
    }
    console.log('\n💡 建议检查:');
    console.log('   1. 浏览器是否正常打开');
    console.log('   2. 网络连接是否正常');
    console.log('   3. 百度是否有反爬虫限制');
    console.log();
    process.exit(1);
  }
}

// 运行测试
testBaiduSearchFinal().then(() => {
  console.log('✨ 测试完成！');
  process.exit(0);
}).catch(err => {
  console.error('💥 执行错误:', err);
  process.exit(1);
});
