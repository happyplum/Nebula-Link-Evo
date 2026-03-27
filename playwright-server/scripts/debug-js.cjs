#!/usr/bin/env node

/**
 * 调试 JavaScript 执行
 */

const axios = require('axios');

const PLAYWRIGHT_URL = 'http://localhost:3001';

async function debugJS() {
  try {
    console.log('🔍 调试 JavaScript 执行...\n');

    // 简单测试
    console.log('1️⃣ 简单测试...');
    const simple = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `return 'Hello World';`
    });
    console.log(`   结果: ${JSON.stringify(simple.data)}\n`);

    // 测试 DOM 查询
    console.log('2️⃣ 测试 DOM 查询...');
    const dom = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `
        const inputs = document.querySelectorAll('input');
        return {
          count: inputs.length,
          ids: Array.from(inputs).slice(0, 5).map(i => i.id || 'no-id')
        };
      `
    });
    console.log(`   结果: ${JSON.stringify(dom.data)}\n`);

    // 测试百度
    console.log('3️⃣ 测试百度页面...');
    const nav = await axios.post(`${PLAYWRIGHT_URL}/browser/navigate`, {
      url: 'https://www.baidu.com',
      waitUntil: 'networkidle'
    });
    console.log(`   标题: ${nav.data.title}`);

    const baidu = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `
        const inputs = document.querySelectorAll('input');
        return {
          count: inputs.length,
          samples: Array.from(inputs).slice(0, 3).map(i => ({
            id: i.id,
            name: i.name,
            type: i.type,
            class: i.className?.substring(0, 20)
          }))
        };
      `
    });
    console.log(`   结果: ${JSON.stringify(baidu.data, null, 2)}\n`);

    // 尝试操作
    console.log('4️⃣ 尝试操作...');
    const op = await axios.post(`${PLAYWRIGHT_URL}/execute/script`, {
      script: `
        const input = document.querySelector('input#kw');
        if (input) {
          input.value = '测试';
          return { success: true, value: input.value };
        }
        return { success: false, error: 'Input not found' };
      `
    });
    console.log(`   结果: ${JSON.stringify(op.data, null, 2)}\n`);

  } catch (error) {
    console.error('错误:', error.response?.data || error.message);
  }
}

debugJS();
