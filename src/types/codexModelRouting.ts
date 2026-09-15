export interface CodexModelSelection {
  providerId: string;
  model: string;
}

export interface CodexModelRoutingConfig {
  enabled: boolean;
  providerName: string;
  models: CodexModelSelection[];
}

export interface CodexModelRoutingCapability {
  providerId: string;
  model: string;
  contextWindow: number | null;
}

export interface ModelRoutingSaveResult {
  config: CodexModelRoutingConfig;
  catalogChanged: boolean;
}
