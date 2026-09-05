export type FeatureId =
  | "interface-optimization"
  | "watch-time"
  | "learning-mode"
  | "watch-queue"
  | "player-tools"
  | "content-filter"
  | "learning-library";
export type PageKind =
  | "home"
  | "video"
  | "cheese"
  | "bangumi"
  | "live"
  | "auth"
  | "search"
  | "space"
  | "other";
export interface PageSnapshot {
  url: string;
  kind: PageKind;
  bvid?: string;
  cheeseEpisodeId?: string;
  pageNumber?: number;
  title?: string;
  uploader?: string;
  coverUrl?: string;
  detectedAt: number;
}
export interface PlayerSnapshot {
  attached: boolean;
  paused: boolean;
  ended: boolean;
  pictureInPicture: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  updatedAt: number;
}
export type QueueStatus = "later" | "soon" | "needs-review" | "completed";
export interface QueueItem {
  id: string;
  bvid?: string;
  cheeseEpisodeId?: string;
  url: string;
  title: string;
  uploader?: string;
  coverUrl?: string;
  metadataFetchedAt?: number;
  addedAt: number;
  updatedAt: number;
  status: QueueStatus;
  dueAt?: number;
  durationSeconds?: number;
  extensionCount: number;
  sortOrder?: number;
  note?: string;
  inaccessible?: boolean;
}
export interface PartProgress {
  pageNumber: number;
  lastPositionSeconds: number;
  maxPositionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  updatedAt: number;
}
export interface CourseProgress {
  key: string;
  bvid?: string;
  cheeseEpisodeId?: string;
  url: string;
  title: string;
  uploader?: string;
  parts: Record<string, PartProgress>;
  totalParts?: number;
  manuallyCompleted?: boolean;
  updatedAt: number;
}
export type BookmarkKind = "point" | "segment";
export type BookmarkTag = "重点" | "疑问" | "待复习";
export interface ClipBookmark {
  id: string;
  kind: BookmarkKind;
  bvid?: string;
  cheeseEpisodeId?: string;
  url: string;
  pageNumber?: number;
  title: string;
  uploader?: string;
  startSeconds: number;
  endSeconds?: number;
  name: string;
  tag?: BookmarkTag;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
export interface AllowedLearningVideo {
  key: string;
  bvid?: string;
  cheeseEpisodeId?: string;
  url: string;
  title: string;
}
export interface LearningSession {
  id: string;
  active: boolean;
  completed: boolean;
  startedAt: number;
  targetSeconds: number;
  elapsedSeconds: number;
  lastCountedAt: number;
  allowedVideos: AllowedLearningVideo[];
  lastLearningUrl?: string;
  updatedAt: number;
}
export interface UsageBucket {
  totalSeconds: number;
  studySeconds: number;
  liveSeconds: number;
}
export interface DailyUsageRecord {
  date: string;
  hours: UsageBucket[];
}
export interface MonthlyUsageRecord extends UsageBucket {
  month: string;
}
export interface UsageStore {
  lastCounted?: Partial<Record<keyof UsageBucket, number>>;
  days: Record<string, DailyUsageRecord>;
  months: Record<string, MonthlyUsageRecord>;
}
export interface UsageSummary {
  today: UsageBucket;
  currentWeek: DailyUsageRecord[];
  recentWeeks: DailyUsageRecord[];
  months: MonthlyUsageRecord[];
  recording: boolean;
}
export interface UsageTick {
  seconds: number;
  recordedAt: number;
  study: boolean;
  live: boolean;
}
export interface AppNotice {
  id: string;
  level: "info" | "warning" | "error";
  title: string;
  message: string;
  createdAt: number;
  read: boolean;
  relatedId?: string;
}
export interface AppDataExport {
  schemaVersion: 2;
  exportedAt: number;
  settings: import("./settings").AppSettings;
  usage: UsageStore;
  queue: QueueItem[];
  bookmarks: ClipBookmark[];
  progress: CourseProgress[];
  notices: AppNotice[];
}
export type ClearableDataSection =
  "usage" | "queue" | "bookmarks" | "progress" | "notices" | "settings";
