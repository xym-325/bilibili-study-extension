import type {
  AppDataExport,
  AppNotice,
  ClearableDataSection,
  ClipBookmark,
  CourseProgress,
  LearningSession,
  PageSnapshot,
  PlayerSnapshot,
  QueueItem,
  QueueStatus,
  UsageSummary,
  UsageTick,
} from "./domain";
import type { AppSettings, SettingsPatch } from "./settings";
export type AddQueueInput = Omit<
  QueueItem,
  "id" | "addedAt" | "updatedAt" | "extensionCount"
>;
export type AddBookmarkInput = Omit<
  ClipBookmark,
  "id" | "createdAt" | "updatedAt"
>;
export type ExtensionMessage =
  | { type: "GET_SETTINGS" }
  | { type: "PATCH_SETTINGS"; patch: SettingsPatch }
  | { type: "RESET_SETTINGS" }
  | { type: "GET_USAGE_SUMMARY" }
  | { type: "RECORD_USAGE_TICK"; tick: UsageTick }
  | { type: "LIST_QUEUE"; status?: QueueStatus }
  | { type: "ADD_QUEUE_ITEM"; item: AddQueueInput }
  | { type: "UPDATE_QUEUE_ITEM"; id: string; patch: Partial<QueueItem> }
  | { type: "DELETE_QUEUE_ITEM"; id: string }
  | { type: "LIST_BOOKMARKS" }
  | { type: "ADD_BOOKMARK"; bookmark: AddBookmarkInput }
  | { type: "UPDATE_BOOKMARK"; id: string; patch: Partial<ClipBookmark> }
  | { type: "DELETE_BOOKMARK"; id: string }
  | { type: "LIST_PROGRESS" }
  | { type: "UPDATE_PROGRESS"; progress: CourseProgress }
  | { type: "RESET_PROGRESS"; key: string }
  | { type: "GET_LEARNING_SESSION" }
  | {
      type: "START_LEARNING_SESSION";
      durationMinutes: number;
      queueItemIds: string[];
    }
  | { type: "STOP_LEARNING_SESSION" }
  | { type: "SET_LEARNING_LAST_URL"; url: string }
  | { type: "GET_NOTICES" }
  | { type: "MARK_NOTICE_READ"; id: string }
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "GET_PLAYER_CONTEXT" }
  | { type: "EXPORT_ALL_DATA" }
  | { type: "IMPORT_ALL_DATA"; data: unknown }
  | { type: "CLEAR_DATA_SECTION"; section: ClearableDataSection }
  | { type: "CLEAR_ALL_DATA" };
export interface MessageResponseMap {
  GET_SETTINGS: AppSettings;
  PATCH_SETTINGS: AppSettings;
  RESET_SETTINGS: AppSettings;
  GET_USAGE_SUMMARY: UsageSummary;
  RECORD_USAGE_TICK: { recorded: true };
  LIST_QUEUE: QueueItem[];
  ADD_QUEUE_ITEM: QueueItem;
  UPDATE_QUEUE_ITEM: QueueItem;
  DELETE_QUEUE_ITEM: { deleted: boolean };
  LIST_BOOKMARKS: ClipBookmark[];
  ADD_BOOKMARK: ClipBookmark;
  UPDATE_BOOKMARK: ClipBookmark;
  DELETE_BOOKMARK: { deleted: boolean };
  LIST_PROGRESS: CourseProgress[];
  UPDATE_PROGRESS: CourseProgress;
  RESET_PROGRESS: { reset: true };
  GET_LEARNING_SESSION: LearningSession | null;
  START_LEARNING_SESSION: LearningSession;
  STOP_LEARNING_SESSION: null;
  SET_LEARNING_LAST_URL: { updated: true };
  GET_NOTICES: AppNotice[];
  MARK_NOTICE_READ: { updated: boolean };
  GET_PAGE_CONTEXT: PageSnapshot;
  GET_PLAYER_CONTEXT: PlayerSnapshot;
  EXPORT_ALL_DATA: AppDataExport;
  IMPORT_ALL_DATA: { imported: true };
  CLEAR_DATA_SECTION: { cleared: ClearableDataSection };
  CLEAR_ALL_DATA: { cleared: true };
}
export type MessageType = keyof MessageResponseMap;
export type MessageResponse<T extends MessageType> =
  | { ok: true; data: MessageResponseMap[T] }
  | { ok: false; error: { code: string; message: string } };
