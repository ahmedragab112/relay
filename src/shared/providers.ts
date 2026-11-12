export type ProviderID =
  | 'opencode'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'cerebras'
  | 'mistral'
  | 'github-models'
  | 'huggingface'
  | 'nvidia'
  | 'sambanova'
  | 'together'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'openai'
  | 'anthropic'
  | 'custom';

export type ConfigurableProviderID = Exclude<ProviderID, 'opencode'>;

export type ProviderGroup = 'free' | 'local' | 'paid' | 'custom';

export interface ProviderPreset {
  id: ProviderID;
  name: string;
  group: ProviderGroup;
  package: string;
  baseURL?: string;
  keyless: boolean;
  description: string;
  keyUrl?: string;
}

const compatible = '@opencode/ai/providers/openai-compatible';

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'opencode', name: 'OpenCode Zen', group: 'free', package: compatible, keyless: true,
    description: 'Free hosted models included with the local engine. No account or key needed.',
  },
  {
    id: 'google', name: 'Google AI Studio', group: 'free', package: '@opencode/ai/providers/google', keyless: false,
    description: 'Gemini free tier. Create an API key in Google AI Studio.', keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter', name: 'OpenRouter', group: 'free', package: '@opencode/ai/providers/openrouter',
    baseURL: 'https://openrouter.ai/api/v1', keyless: false,
    description: 'Free models are marked with :free. Free-only mode hides paid models.', keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'groq', name: 'Groq', group: 'free', package: compatible, baseURL: 'https://api.groq.com/openai/v1', keyless: false,
    description: 'Fast free tier for open models, including Whisper transcription.', keyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'cerebras', name: 'Cerebras', group: 'free', package: compatible, baseURL: 'https://api.cerebras.ai/v1', keyless: false,
    description: 'Free tier for fast open-model inference.', keyUrl: 'https://cloud.cerebras.ai/',
  },
  {
    id: 'mistral', name: 'Mistral', group: 'free', package: compatible, baseURL: 'https://api.mistral.ai/v1', keyless: false,
    description: 'Mistral free tier for open models.', keyUrl: 'https://console.mistral.ai/api-keys/',
  },
  {
    id: 'github-models', name: 'GitHub Models', group: 'free', package: compatible, baseURL: 'https://models.github.ai/inference', keyless: false,
    description: 'Free model playground with a GitHub personal access token.', keyUrl: 'https://github.com/settings/tokens',
  },
  {
    id: 'huggingface', name: 'Hugging Face', group: 'free', package: compatible, baseURL: 'https://router.huggingface.co/v1', keyless: false,
    description: 'Inference router with a free monthly allowance.', keyUrl: 'https://huggingface.co/settings/tokens',
  },
  {
    id: 'nvidia', name: 'NVIDIA NIM', group: 'free', package: compatible, baseURL: 'https://integrate.api.nvidia.com/v1', keyless: false,
    description: 'NVIDIA hosted models with free developer credits.', keyUrl: 'https://build.nvidia.com/',
  },
  {
    id: 'sambanova', name: 'SambaNova', group: 'free', package: compatible, baseURL: 'https://api.sambanova.ai/v1', keyless: false,
    description: 'Free developer tier for open models.', keyUrl: 'https://cloud.sambanova.ai/',
  },
  {
    id: 'together', name: 'Together AI', group: 'free', package: compatible, baseURL: 'https://api.together.xyz/v1', keyless: false,
    description: 'Open-model hosting with starter credits.', keyUrl: 'https://api.together.xyz/settings/api-keys',
  },
  {
    id: 'ollama', name: 'Ollama', group: 'local', package: compatible, baseURL: 'http://localhost:11434/v1', keyless: true,
    description: 'Models running on this Mac. No key or network request leaves the machine.',
  },
  {
    id: 'lmstudio', name: 'LM Studio', group: 'local', package: compatible, baseURL: 'http://localhost:1234/v1', keyless: true,
    description: 'Local OpenAI-compatible server from LM Studio.',
  },
  {
    id: 'llamacpp', name: 'llama.cpp', group: 'local', package: compatible, baseURL: 'http://localhost:8080/v1', keyless: true,
    description: 'Local llama.cpp server with its OpenAI-compatible API.',
  },
  {
    id: 'openai', name: 'OpenAI', group: 'paid', package: '@opencode/ai/providers/openai', keyless: false,
    description: 'Paid OpenAI API models.', keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic', name: 'Anthropic', group: 'paid', package: '@opencode/ai/providers/anthropic', keyless: false,
    description: 'Paid Anthropic Claude models.', keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'custom', name: 'Custom', group: 'custom', package: compatible, keyless: true,
    description: 'Any OpenAI-compatible endpoint with a model ID you provide.',
  },
];

export const CONFIGURABLE_PROVIDERS = PROVIDER_PRESETS.filter((preset): preset is ProviderPreset & { id: ConfigurableProviderID } => preset.id !== 'opencode');

export function providerPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export function providerName(id: string): string {
  return providerPreset(id)?.name ?? id;
}

export function isProviderID(value: unknown): value is ProviderID {
  return typeof value === 'string' && PROVIDER_PRESETS.some((preset) => preset.id === value);
}

export function isConfigurableProviderID(value: unknown): value is ConfigurableProviderID {
  return typeof value === 'string' && CONFIGURABLE_PROVIDERS.some((preset) => preset.id === value);
}
