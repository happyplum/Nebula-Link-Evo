#!/usr/bin/env node

/**
 * Agent MCP 调用完整流程测试
 * 测试 AI 主动调用 MCP 工具获取页面信息的完整流程
 */

const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PLAYWRIGHT_URL = 'http://localhost:3001';
const PROXY_URL = 'http://localhost:3000';
const DEBUG_PAGE_URL = `${PROXY_URL}/debug`;

// 从项目 config.json 加载配置
function loadConfig() {
  const configPaths = [
    path.join(__dirname, '..', '..', 'config', 'config.json'),
    path.join(__dirname, '..', '..', '..', 'config', 'config.json'),
    path.join(process.cwd(), '..', 'config', 'config.json'),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
      } catch (e) {
        console.warn(`Failed to load config from ${configPath}:`, e.message);
      }
    }
  }
  return null;
}

const config = loadConfig();
const DEFAULT_PROVIDER = config?.defaults?.decision?.provider || 'glm';
const DEFAULT_DECISION_MODEL = config?.defaults?.decision?.model || 'glm-4.7-flash';
const DEFAULT_VISION_MODEL = config?.defaults?.vision?.model || 'glm-4.6v-flash';

console.log(`[Config] Decision: ${DEFAULT_PROVIDER}/${DEFAULT_DECISION_MODEL}`);
console.log(`[Config] Vision: ${DEFAULT_PROVIDER}/${DEFAULT_VISION_MODEL}`);

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  reset: '\x1b[0m'
};

function log(color, ...args) {
  console.log(colors[color] || '', ...args, colors.reset);
}

function logSection(title) {
  console.log('\n' + '═'.repeat(60));
  log('cyan', `  ${title}`);
  console.log('═'.repeat(60));
}

function logStep(num, desc) {
  log('blue', `\n${num}️⃣ ${desc}`);
}

function logSuccess(msg) {
  log('green', `   ✅ ${msg}`);
}

function logError(msg) {
  log('red', `   ❌ ${msg}`);
}

function logInfo(msg) {
  log('yellow', `   ℹ️  ${msg}`);
}

function logAI(msg) {
  log('magenta', `   🤖 ${msg}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class PlaywrightClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async get(path) {
    const res = await axios.get(`${this.baseUrl}${path}`);
    return res.data;
  }

  async post(path, data = {}) {
    const res = await axios.post(`${this.baseUrl}${path}`, data);
    return res.data;
  }

  async openBrowser(options = {}) {
    return this.post('/browser/open', { headless: false, viewport: { width: 1920, height: 1080 }, ...options });
  }

  async closeBrowser() {
    return this.post('/browser/close');
  }

  async navigate(url) {
    return this.post('/browser/navigate', { url, waitUntil: 'networkidle', timeout: 30000 });
  }

  async screenshot() {
    return this.post('/browser/screenshot', { fullPage: false });
  }

  async executeScript(script) {
    return this.post('/execute/script', { script });
  }
}

class ProxyAdapterClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async post(path, data = {}) {
    const res = await axios.post(`${this.baseUrl}${path}`, data);
    return res.data;
  }

  async get(path) {
    const res = await axios.get(`${this.baseUrl}${path}`);
    return res.data;
  }

  async createSession(title, provider, model) {
    return this.post('/debug/api/chat/sessions', { title, provider, model });
  }

  async getSession(sessionId) {
    return this.get(`/debug/api/chat/sessions/${sessionId}`);
  }

  async deleteSession(sessionId) {
    return axios.delete(`${this.baseUrl}/debug/api/chat/sessions/${sessionId}`);
  }
}

class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.messageHandlers = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        logSuccess('WebSocket 连接成功');
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.messageHandlers.forEach(handler => handler(message));
        } catch (e) {
          logError(`解析消息失败: ${e.message}`);
        }
      });

      this.ws.on('error', (error) => {
        logError(`WebSocket 错误: ${error.message}`);
        reject(error);
      });

      this.ws.on('close', () => {
        logInfo('WebSocket 连接关闭');
      });
    });
  }

  send(data) {
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(data), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  onMessage(handler) {
    this.messageHandlers.push(handler);
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }

  waitForMessage(type, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`等待消息超时: ${type}`));
      }, timeout);

      const handler = (message) => {
        if (message.type === type) {
          clearTimeout(timer);
          this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
          resolve(message);
        }
      };

      this.messageHandlers.push(handler);
    });
  }
}

async function testAgentMCPFlow() {
  const pw = new PlaywrightClient(PLAYWRIGHT_URL);
  const proxy = new ProxyAdapterClient(PROXY_URL);
  let wsClient = null;
  let testSessionId = null;

  try {
    // ========== 阶段1: 环境准备 ==========
    logSection('阶段1: 环境准备');

    logStep(1, '重置浏览器');
    try {
      await pw.closeBrowser();
      await sleep(1000);
    } catch (e) {}

    logStep(2, '打开浏览器并导航到测试页面');
    await pw.openBrowser({ headless: false });
    await sleep(2000);
    await pw.navigate('https://example.com');
    await sleep(2000);
    logSuccess('浏览器已打开并导航到 example.com');

    logStep(3, '获取页面截图');
    const screenshot = await pw.screenshot();
    logSuccess(`截图大小: ${(screenshot.screenshot.length / 1024).toFixed(2)} KB`);

    // ========== 阶段2: WebSocket 连接 ==========
    logSection('阶段2: WebSocket 连接');

    logStep(1, '连接 WebSocket');
    wsClient = new WebSocketClient(`ws://localhost:3000/debug/ws`);
    await wsClient.connect();

    // ========== 阶段3: 测试1 - 视觉模型分析截图 ==========
    logSection('阶段3: 视觉模型分析截图测试');

    logStep(1, '创建视觉模型会话');
    const visionSession = await proxy.createSession('视觉模型测试', DEFAULT_PROVIDER, DEFAULT_VISION_MODEL);
    testSessionId = visionSession.session?.id;
    logSuccess(`会话 ID: ${testSessionId}`);

    logStep(2, '发送消息并附带截图');
    
    const messages = [];
    wsClient.onMessage((msg) => {
      if (msg.type === 'chat_stream_token') {
        process.stdout.write(msg.text || '');
      }
      messages.push(msg);
    });

    await wsClient.send({
      type: 'chat_send',
      sessionId: testSessionId,
      message: '请分析这张截图，告诉我页面上有什么内容，标题是什么。',
      screenshot: screenshot.screenshot
    });

    logInfo('等待 AI 响应...');
    
    // 等待响应完成
    await new Promise((resolve) => {
      const checkEnd = (msg) => {
        if (msg.type === 'chat_stream_end') {
          resolve();
        }
      };
      wsClient.onMessage(checkEnd);
      setTimeout(resolve, 60000);
    });

    await sleep(1000);

    logStep(3, '检查响应结果');
    const visionResult = await proxy.getSession(testSessionId);
    const visionMessages = visionResult.messages || [];
    
    if (visionMessages.length >= 2) {
      const assistantMsg = visionMessages.find(m => m.role === 'assistant');
      if (assistantMsg) {
        logSuccess('AI 响应已保存');
        logAI(`响应内容: ${assistantMsg.content.substring(0, 200)}...`);
      }
    }

    // ========== 阶段4: 测试2 - Agent 主动调用 MCP ==========
    logSection('阶段4: Agent 主动调用 MCP 测试');

    logStep(1, '创建新的 Agent 会话');
    const agentSession = await proxy.createSession('Agent MCP测试', DEFAULT_PROVIDER, DEFAULT_DECISION_MODEL);
    const agentSessionId = agentSession.session?.id;
    logSuccess(`会话 ID: ${agentSessionId}`);

    logStep(2, '发送请求让 AI 调用 MCP 工具');
    
    const agentMessages = [];
    wsClient.onMessage((msg) => {
      agentMessages.push(msg);
      if (msg.type === 'chat_stream_token') {
        process.stdout.write(msg.text || '');
      }
    });

    await wsClient.send({
      type: 'chat_send',
      sessionId: agentSessionId,
      message: '请使用 browser_snapshot 工具获取当前页面信息，然后告诉我页面的标题是什么。'
    });

    logInfo('等待 AI 调用 MCP 并响应...');
    logInfo('(这可能需要 30-60 秒)');

    // 等待响应完成
    await new Promise((resolve) => {
      const checkEnd = (msg) => {
        if (msg.type === 'chat_stream_end' && msg.sessionId === agentSessionId) {
          resolve();
        }
      };
      wsClient.onMessage(checkEnd);
      setTimeout(resolve, 90000);
    });

    await sleep(2000);

    logStep(3, '检查 Agent 响应结果');
    const agentResult = await proxy.getSession(agentSessionId);
    const agentSessionMessages = agentResult.messages || [];
    
    logInfo(`消息数量: ${agentSessionMessages.length}`);
    
    let foundMCPCall = false;
    let foundToolResult = false;
    let foundFinalResponse = false;

    for (const msg of agentSessionMessages) {
      if (msg.role === 'assistant') {
        if (msg.content.includes('mcp_call') || msg.content.includes('browser_snapshot')) {
          foundMCPCall = true;
          logAI(`检测到 MCP 调用指令: ${msg.content.substring(0, 150)}...`);
        } else if (msg.content.includes('example') || msg.content.includes('Example') || msg.content.includes('页面')) {
          foundFinalResponse = true;
          logAI(`最终响应: ${msg.content.substring(0, 200)}...`);
        }
      }
      if (msg.role === 'tool') {
        foundToolResult = true;
        logSuccess(`工具调用结果已保存`);
      }
    }

    if (foundMCPCall) {
      logSuccess('✅ AI 成功返回 MCP 调用指令');
    } else {
      logError('❌ 未检测到 MCP 调用指令');
    }

    if (foundToolResult) {
      logSuccess('✅ MCP 工具调用成功执行');
    } else {
      logError('❌ MCP 工具调用未执行');
    }

    if (foundFinalResponse) {
      logSuccess('✅ AI 基于工具结果返回了最终响应');
    } else {
      logError('❌ AI 未返回基于工具结果的响应');
    }

    // ========== 阶段5: 清理 ==========
    logSection('阶段5: 清理');

    logStep(1, '删除测试会话');
    try {
      if (testSessionId) await proxy.deleteSession(testSessionId);
      if (agentSessionId) await proxy.deleteSession(agentSessionId);
      logSuccess('测试会话已删除');
    } catch (e) {
      logError(`删除会话失败: ${e.message}`);
    }

    logStep(2, '关闭 WebSocket');
    if (wsClient) {
      wsClient.close();
      logSuccess('WebSocket 已关闭');
    }

    logStep(3, '关闭浏览器');
    await pw.closeBrowser();
    logSuccess('浏览器已关闭');

    // ========== 总结 ==========
    logSection('测试总结');
    
    console.log('\n   Agent MCP 调用流程测试结果:');
    console.log(`   ${foundMCPCall ? '✅' : '❌'} AI 返回 MCP 调用指令`);
    console.log(`   ${foundToolResult ? '✅' : '❌'} MCP 工具执行成功`);
    console.log(`   ${foundFinalResponse ? '✅' : '❌'} AI 返回最终响应`);
    
    const allPassed = foundMCPCall && foundToolResult && foundFinalResponse;
    
    if (allPassed) {
      logSuccess('\n🎉 所有测试通过！Agent MCP 调用流程正常工作！');
    } else {
      logError('\n⚠️ 部分测试未通过，请检查日志');
    }

    return allPassed;

  } catch (error) {
    logError(`测试执行失败: ${error.message}`);
    console.error(error);
    
    // 清理
    try {
      if (wsClient) wsClient.close();
      await pw.closeBrowser();
    } catch (e) {}
    
    return false;
  }
}

// 运行测试
testAgentMCPFlow().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('测试执行错误:', err);
  process.exit(1);
});
