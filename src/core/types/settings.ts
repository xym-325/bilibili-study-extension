import type { FeatureId } from "./domain";
export interface AppSettings {
  schemaVersion: 2;
  onboardingComplete: boolean;
  features: Record<FeatureId, boolean>;
  interfaceOptimization: {
    hideAds: boolean;
    hideLiveCards: boolean;
    hiddenBadges: string[];
  };
  watchTime: {
    dwellSeconds: number;
    inactiveSeconds: number;
    detailRetentionWeeks: number;
  };
  learningMode: { minimumMinutes: number; maximumMinutes: number };
  queue: {
    laterDays: number;
    soonDays: number;
    soonSoftLimit: number;
    soonSoftMinutes: number;
    completionRatio: number;
  };
  playerTools: {
    shortcutsEnabled: boolean;
    shortcuts: {
      setA: string;
      setB: string;
      clearLoop: string;
      savePoint: string;
      saveSegment: string;
    };
  };
  contentFilter: { keywords: string[] };
}
export type SettingsPatch = {
  [K in keyof AppSettings]?: AppSettings[K] extends Record<string, unknown>
    ? Partial<AppSettings[K]>
    : AppSettings[K];
};
