export interface AppConfig {
  api: {
    base_url: string;
    key: string;
    model: string;
  };
  context: {
    fold_threshold: number;
    fold_aggressive_threshold: number;
    force_summary_threshold: number;
    tail_fraction: number;
    tail_fraction_aggressive: number;
    max_tokens?: number;
  };
  memory: {
    dream: {
      min_score: number;
      min_recurrence: number;
    };
  };
  world?: {
    token_budget?: number;
    scan_depth?: number;
  };
}
