// Client-safe AI analysis types (mirrors the server-side zod schemas)

export interface PortfolioAnalysis {
  executiveSummary: string;
  riskAssessment: {
    overallRiskLevel: "low" | "moderate" | "elevated" | "high";
    concentrationRisk: string;
    marketExposure: string;
    correlationRisk: string;
  };
  sectorAllocation: {
    analysis: string;
    overweights: string[];
    underweights: string[];
    recommendations: string[];
  };
  topPositions: {
    name: string;
    observation: string;
  }[];
  hedgingSuggestions: {
    suggestion: string;
    rationale: string;
  }[];
  keyRisks: {
    risk: string;
    mitigation: string;
  }[];
  actionItems: string[];
}

export interface PositionAnalysis {
  summary: string;
  fundamentalAssessment: {
    businessQuality: string;
    competitivePosition: string;
    growthOutlook: string;
    managementQuality: string;
  };
  valuationOpinion: {
    currentValuation: string;
    historicalContext: string;
    relativeValue: string;
    fairValueRange: string;
  };
  riskFactors: {
    factor: string;
    severity: "low" | "medium" | "high";
    description: string;
  }[];
  catalysts: {
    catalyst: string;
    timeframe: string;
    impact: "positive" | "negative";
  }[];
  positionSizing: {
    currentWeight: string;
    recommendedAction: "increase" | "maintain" | "reduce" | "exit";
    rationale: string;
  };
}
