import type { AppSettings } from "../types/settings";

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 2,
  onboardingComplete: false,
  features: {
    "interface-optimization": false,
    "watch-time": false,
    "learning-mode": false,
    "watch-queue": false,
    "player-tools": false,
    "content-filter": false,
    "learning-library": false,
  },
  interfaceOptimization: {
    hideAds: true,
    hideLiveCards: true,
    hiddenBadges: [],
  },
  watchTime: {
    dwellSeconds: 10,
    inactiveSeconds: 300,
    detailRetentionWeeks: 8,
  },
  learningMode: { minimumMinutes: 10, maximumMinutes: 360 },
  queue: {
    laterDays: 30,
    soonDays: 7,
    soonSoftLimit: 5,
    soonSoftMinutes: 180,
    completionRatio: 0.9,
  },
  playerTools: {
    shortcutsEnabled: true,
    shortcuts: {
      setA: "Alt+BracketLeft",
      setB: "Alt+BracketRight",
      clearLoop: "Alt+Backslash",
      savePoint: "Alt+KeyM",
      saveSegment: "Alt+KeyS",
    },
  },
  contentFilter: { keywords: [], mode: "any" },
};

export const STORAGE_KEYS = {
  meta: "bse.meta.v2",
  settings: "bse.settings.v2",
  usage: "bse.usage.v2",
  queue: "bse.queue.v2",
  bookmarks: "bse.bookmarks.v2",
  progress: "bse.progress.v2",
  learningSession: "bse.learning-session.v2",
  notices: "bse.notices.v2",
} as const;
export const MAINTENANCE_ALARM = "bse.daily-maintenance";
