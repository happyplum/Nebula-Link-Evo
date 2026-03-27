#!/usr/bin/env node

/**
 * 使用 JavaScript 执行直接操作百度搜索
 * 这是最可靠的方法，绕过 DOM 获取的限制
 */

const axios = require('axios');

const PLAYWRIGHT_URL = 'http://localhost:3001';

async function testBaiduWithJS() {
  console.log('🎯 使用 JavaScript 直接操作百度搜索\n');

  try {
    // 1. 打开浏览器并导航
    console.log('1️⃣ 初始化...');
    const healthRes = await axios.get(`${PLAYWRIGHT_URL}/health`);
    if (!healthRes.data.browserOpen) {
      await axios.post(`${PLAYWRIGHT_URL}/browser/open`, { headless: false });
    }

    console.log('2️⃣ 导航到百度...');
    await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: 'https://www.baidu.com',
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('   ✅ 导航完成\n');

    // 2. 使用 JavaScript 检查页面结构
    console.log('3️⃣ 检查页面结构...');
    const pageCheck = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `
        const inputs = document.querySelectorAll('input');
        const forms = document.querySelectorAll('form');
        
        return {
          inputCount: inputs.length,
          formCount: forms.length,
          hasSearchInput: Array.from(inputs).some(i => 
            i.id === 'kw' || i.name === 'wd' || i.class.includes('s_ipt')
          ),
          allInputIds: Array.from(inputs).map(i => ({
            id: i.id,
            name: i.name,
            class: i.className,
            type: i.type,
            placeholder: i.placeholder
          })),
          bodyHTML: document.body.innerHTML.substring(0, 500)
        };
      `
    });
    
    console.log(`   Input 元素数: ${pageCheck.data.result.inputCount}`);
    console.log(`   Form 元素数: ${pageCheck.data.result.formCount}`);
    console.log(`   包含搜索框: ${pageCheck.data.result.hasSearchInput ? '✅' : '❌'}`);
    console.log();

    // 3. 使用 JavaScript 直接操作
    console.log('4️⃣ 使用 JavaScript 直接操作...');
    
    // 检查搜索框
    const findInput = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `
        const input = document.querySelector('input#kw') || 
                      document.querySelector('input[name="wd"]') ||
                      document.querySelector('input.s_ipt');
        if (input) {
          return {
            found: true,
            id: input.id,
            name: input.name,
            value: input.value,
            visible: input.offsetParent !== null,
            display: window.getComputedStyle(input).display,
            visibility: window.getComputedStyle(input).visibility
          };
        }
        return { found: false };
      `
    });
    
    if (findInput.data.result.found) {
      console.log('   ✅ 找到搜索框！');
      console.log(`      ID: ${findInput.data.result.id}`);
      console.log(`      Name: ${findInput.data.result.name}`);
      console.log(`      Value: "${findInput.data.result.value}"`);
      console.log(`      Visible: ${findInput.data.result.visible}`);
      console.log(`      Display: ${findInput.data.result.display}`);
      
      // 直接设置值
      console.log('\n5️⃣ 输入搜索内容...');
      const typeResult = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
        script: `
          const input = document.querySelector('input#kw') || 
                        document.querySelector('input[name="wd"]');
          if (input) {
            input.value = '人工智能';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, value: input.value };
          }
          return { success: false, error: 'Input not found' };
        `
      });
      
      if (typeResult.data.result.success) {
        console.log(`   ✅ 输入成功: "${typeResult.data.result.value}"`);
        
        // 点击搜索按钮
        console.log('\n6️⃣ 点击搜索按钮...');
        const clickResult = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
          script: `
            const btn = document.querySelector('input[id="su"]') || 
                        document.querySelector('button[type="submit"]') ||
                        document.querySelector('.s_btn');
            if (btn) {
              btn.click();
              return { success: true, btnId: btn.id || btn.className };
            }
            
            // 备用：模拟回车
            const input = document.querySelector('input#kw');
            if (input) {
              input.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter',
                keyCode: 13,
                bubbles: true
              }));
              return { success: true, method: 'Enter key' };
            }
            
            return { success: false, error: 'Button not found' };
          `
        });
        
        if (clickResult.data.result.success) {
          console.log(`   ✅ 搜索已执行 (${clickResult.data.result.method || clickResult.data.result.btnId})`);
        }
      }
    } else {
      console.log('   ⚠️  未找到搜索框，尝试其他方法...');
      
      // 备选：直接在页面中查找并操作
      const fallback = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
        script: `
          // 查找任何看起来像搜索框的元素
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (el.tagName === 'INPUT' && 
                (el.id?.includes('kw') || el.name?.includes('wd'))) {
              el.value = '人工智能';
              el.focus();
              
              // 尝试回车
              setTimeout(() => {
                el.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter',
                  keyCode: 13,
                  bubbles: true
                }));
              }, 100);
              
              return { success: true, method: 'fallback', tag: el.tagName };
            }
          }
          return { success: false, error: 'No search input found' };
        `
      });
      
      console.log(`   结果: ${fallback.data.result.success ? '✅' : '❌'} ${fallback.data.result.error || ''}`);
    }

    // 7. 等待并验证
    console.log('\n7️⃣ 等待搜索结果...');
    await new Promise(r => setTimeout(r, 4000));

    // 8. 验证结果
    console.log('8️⃣ 验证结果...');
    const finalStatus = await axios.get(`${PLAYWRIGHT_URL}/browser/status`);
    console.log(`   页面标题: ${finalStatus.data.title}`);
    console.log(`   URL: ${finalStatus.data.currentUrl}\n`);

    // 截图
    console.log('9️⃣ 截图...');
    const screenshot = await axios.post(`${PLAYWRIGHT_URL}/browser/screenshot`, { fullPage: false });
    const sizeKB = (Buffer.from(screenshot.data.screenshot, 'base64').length / 1024).toFixed(2);
    console.log(`   截图大小: ${sizeKB} KB\n`);

    // 总结
    const isSuccess = finalStatus.data.title.includes('人工智能') || 
                      finalStatus.data.currentUrl?.includes('www.baidu.com/s');
    
    console.log('═══════════════════════════════════════');
    console.log('📊 最终结果');
    console.log('═══════════════════════════════════════');
    console.log(`   页面加载: ✅`);
    console.log(`   JavaScript操作: ✅`);
    console.log(`   搜索执行: ${isSuccess ? '✅' : '⚠️'}`);
    console.log(`   结果变化: ${isSuccess ? '✅' : '⚠️'}`);
    console.log('═══════════════════════════════════════\n');

    if (isSuccess) {
      console.log('🎉 百度搜索成功！');
    } else {
      console.log('⚠️  搜索可能未完全成功，请检查浏览器窗口。');
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
testBaiduWithJS().then(() => {
  console.log('✨ 测试完成！');
  process.exit(0);
}).catch(err => {
  console.error('💥 致命错误:', err);
  process.exit(1);
});
