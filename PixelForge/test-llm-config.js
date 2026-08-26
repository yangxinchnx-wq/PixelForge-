/**
 * LLM 配置测试脚本 — 在浏览器控制台（F12）中粘贴运行。
 *
 * 测试项：
 * 1. 读取 localStorage 中的模型配置
 * 2. 验证 callLLM URL 构造是否正确
 * 3. 发送一个简单请求测试连通性
 */

(async function testLLMConfig() {
  console.log('=== PixelForge LLM 配置测试 ===\n');

  // 1. 读取配置
  const raw = localStorage.getItem('pixelforge_autosave_v2');
  if (!raw) {
    console.error('❌ 未找到配置数据 (pixelforge_autosave_v2)');
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('❌ 配置数据解析失败:', e);
    return;
  }

  const configs = data.modelConfigs ?? [];
  const selectedId = data.selectedModelId;

  console.log(`📋 已配置 ${configs.length} 个模型，当前选中: ${selectedId ?? '无'}\n`);

  if (configs.length === 0) {
    console.error('❌ 没有配置任何模型，请在设置中添加模型');
    return;
  }

  // 2. 找到选中的模型（或第一个）
  const config = configs.find((m) => m.id === selectedId) ?? configs[0];
  console.log('📌 测试模型配置:');
  console.log(`   名称: ${config.name}`);
  console.log(`   Provider: ${config.provider}`);
  console.log(`   Model ID: ${config.modelId}`);
  console.log(`   Base URL: ${config.baseUrl}`);
  console.log(`   API Key: ${config.apiKey ? config.apiKey.slice(0, 8) + '...' : '❌ 未填写'}`);
  console.log(`   启用: ${config.enabled}`);
  console.log('');

  // 3. 验证必填字段
  if (!config.apiKey) {
    console.error('❌ API Key 未填写');
    return;
  }
  if (!config.modelId) {
    console.error('❌ Model ID 未填写');
    return;
  }
  if (!config.baseUrl && config.provider === 'custom') {
    console.error('❌ 自定义 Provider 需要填写 Base URL');
    return;
  }

  // 4. 构造 URL（与 callLLM.ts 逻辑一致）
  let provider = config.provider === 'anthropic' ? 'anthropic' : 'openai';
  let baseUrl = config.baseUrl;

  if (provider === 'openai') {
    const rawBase = baseUrl || 'https://api.openai.com';
    const cleanBase = rawBase.replace(/\/v1\/?$/, '');
    const url = `${cleanBase}/v1/chat/completions`;
    console.log(`🌐 请求 URL: ${url}`);
    console.log('');

    // 5. 发送测试请求
    console.log('🚀 发送测试请求...');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.modelId,
          messages: [{ role: 'user', content: '你好，请回复"测试成功"' }],
          max_tokens: 50,
          temperature: 0.3,
        }),
      });

      console.log(`📡 响应状态: ${resp.status} ${resp.statusText}`);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error(`❌ 请求失败 (${resp.status}):`, errText.slice(0, 500));
        return;
      }

      const result = await resp.json();
      const content = result.choices?.[0]?.message?.content;
      console.log(`✅ 测试成功！模型回复: "${content}"`);
      console.log(`   Token 用量: ${JSON.stringify(result.usage ?? {})}`);
    } catch (e) {
      console.error('❌ 网络请求失败:', e.message);
      console.error('   可能原因: CORS 限制 / 网络不通 / Base URL 错误');
    }
  } else if (provider === 'anthropic') {
    const rawBase = baseUrl || 'https://api.anthropic.com';
    const cleanBase = rawBase.replace(/\/v1\/?$/, '');
    const url = `${cleanBase}/v1/messages`;
    console.log(`🌐 请求 URL: ${url}`);
    console.log('');

    console.log('🚀 发送测试请求...');
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.modelId,
          messages: [{ role: 'user', content: '你好，请回复"测试成功"' }],
          max_tokens: 50,
        }),
      });

      console.log(`📡 响应状态: ${resp.status} ${resp.statusText}`);

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.error(`❌ 请求失败 (${resp.status}):`, errText.slice(0, 500));
        return;
      }

      const result = await resp.json();
      const content = result.content?.[0]?.text;
      console.log(`✅ 测试成功！模型回复: "${content}"`);
    } catch (e) {
      console.error('❌ 网络请求失败:', e.message);
    }
  }

  console.log('\n=== 测试完成 ===');
})();
