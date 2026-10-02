export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Provider = {
  name: string;
  endpoint: string;
  apiKey: string;
  model: string;
  headers?: Record<string, string>;
};

export type RouteRule = {
  when: (task: string) => boolean;
  provider: string;
};

export class AIProviderRouter {
  private providers = new Map<string, Provider>();
  private rules: RouteRule[] = [];

  addProvider(provider: Provider) {
    this.providers.set(provider.name, provider);
    return this;
  }

  addRule(rule: RouteRule) {
    this.rules.push(rule);
    return this;
  }

  pick(task: string): Provider {
    const selected = this.rules.find((rule) => rule.when(task));
    const fallback = this.providers.values().next().value as Provider | undefined;
    const provider = selected ? this.providers.get(selected.provider) : fallback;

    if (!provider) throw new Error("No AI provider configured");
    return provider;
  }

  async chat(task: string, messages: ChatMessage[]) {
    const provider = this.pick(task);

    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${provider.apiKey}`,
        ...provider.headers
      },
      body: JSON.stringify({ model: provider.model, messages })
    });

    if (!response.ok) {
      throw new Error(`${provider.name} returned ${response.status}`);
    }

    return response.json();
  }
}
