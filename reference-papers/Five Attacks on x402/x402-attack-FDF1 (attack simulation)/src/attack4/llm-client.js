import axios from "axios";

const PROVIDERS = {
  minimax: {
    apiUrlEnv: "MINIMAX_API_URL",
    apiKeyEnv: "MINIMAX_API_KEY",
    modelEnv: "MINIMAX_MODEL",
    defaultApiUrl: "https://api.minimaxi.chat/v1/chat/completions",
    defaultModel: "MiniMax-M2.7",
    outputSuffix: "minimax",
    style: "chat-completions",
    maxTokenField: "max_tokens",
    maxTokens: 500,
    temperature: 0.1,
  },
  openai: {
    apiUrlEnv: "OPENAI_API_URL",
    apiKeyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    defaultApiUrl: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-5.3-chat-latest",
    outputSuffix: "gpt53",
    style: "chat-completions",
    maxTokenField: "max_completion_tokens",
    maxTokens: 2000,
  },
  anthropic: {
    apiUrlEnv: "ANTHROPIC_API_URL",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultApiUrl: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-5",
    outputSuffix: "sonnet45",
    style: "anthropic",
    maxTokens: 50,
  },
};

export function getProvider() {
  const name = (process.env.ATTACK4_PROVIDER || "minimax").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`unknown ATTACK4_PROVIDER=${name}`);
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`set ${provider.apiKeyEnv} before running this script`);
  }

  return {
    ...provider,
    name,
    apiUrl: process.env[provider.apiUrlEnv] || provider.defaultApiUrl,
    apiKey,
    model: process.env[provider.modelEnv] || process.env.ATTACK4_MODEL || provider.defaultModel,
    outputSuffix: process.env.ATTACK4_OUTPUT_SUFFIX || provider.outputSuffix,
  };
}

export async function callSelectorLLM(client, system, user, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const content = client.style === "anthropic"
        ? await callAnthropic(client, system, user)
        : await callChatCompletions(client, system, user);
      const cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const match = cleaned.match(/\d+/);
      return match ? Number.parseInt(match[0], 10) : null;
    } catch (err) {
      if (err.response?.status === 429 && attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 10_000 * (attempt + 1)));
        continue;
      }
      if (err.response) {
        console.error(`  API error ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 160)}`);
      }
      return null;
    }
  }
  return null;
}

async function callChatCompletions(client, system, user) {
  const body = {
    model: client.model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    [client.maxTokenField]: client.maxTokens,
  };
  if (client.temperature != null) body.temperature = client.temperature;

  const res = await axios.post(client.apiUrl, body, {
    headers: {
      Authorization: `Bearer ${client.apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 30_000,
  });
  return res.data.choices?.[0]?.message?.content || "";
}

async function callAnthropic(client, system, user) {
  const res = await axios.post(client.apiUrl, {
    model: client.model,
    max_tokens: client.maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  }, {
    headers: {
      "x-api-key": client.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    timeout: 30_000,
  });
  return res.data.content?.[0]?.text || "";
}
