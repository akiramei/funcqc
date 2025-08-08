export interface OverviewOptions {
  showTypes?: boolean;
  showFunctions?: boolean;
  showIntegration?: boolean;
  showValidation?: boolean;
  // TODO: Uncomment when implementations are completed
  // analyzeUsage?: boolean;
  // analyzeCoupling?: boolean;
  // analyzeCohesion?: boolean;
  file?: string;
  limit?: number;
  riskThreshold?: number;
  json?: boolean;
  verbose?: boolean;
  snapshotId?: string;
}