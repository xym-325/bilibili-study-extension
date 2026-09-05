import { FilterSettings } from "./FilterSettings";
import { learningRemaining, learningLocked } from "../../core/learning/session";
import { checkSiteAccess } from "../permissions";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendMessage } from "../../core/message/client";
import { parseBvid, parseCheeseEpisodeId } from "../../core/page/detect";
import type {
  AppDataExport,
  ClearableDataSection,
  ClipBookmark,
  CourseProgress,
  DailyUsageRecord,
  FeatureId,
  LearningSession,
  QueueItem,
  QueueStatus,
  UsageSummary,
} from "../../core/types/domain";
import type { AppSettings } from "../../core/types/settings";
import "../shared.css";

type View =
  | "optimization"
  | "features"
  | "stats"
  | "queue"
  | "learning"
  | "library"
  | "data";
const features: Record<FeatureId, string> = {
  "interface-optimization": "界面优化",
  "watch-time": "观看时长",
  "learning-mode": "严格学习模式",
  "watch-queue": "观看队列",
  "player-tools": "AB循环",
  "content-filter": "评论与弹幕过滤",
  "learning-library": "学习沉淀",
};
const statusLabels: Record<QueueStatus, string> = {
  later: "稍后看",
  soon: "近期观看",
  "needs-review": "待处理",
  completed: "已完成",
};
const sectionLabels: Record<ClearableDataSection, string> = {
  usage: "观看统计",
  queue: "观看队列",
  bookmarks: "时间点与片段",
  progress: "课程进度",
  notices: "插件提醒",
  settings: "功能设置",
};
const duration = (seconds: number) => {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))}秒`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}小时${m}分` : `${m}分钟`;
};
const date = (timestamp?: number) =>
  timestamp ? new Date(timestamp).toLocaleDateString() : "—";
function courseComplete(item: CourseProgress): boolean {
  if (item.manuallyCompleted !== undefined) return item.manuallyCompleted;
  const parts = Object.values(item.parts);
  return (
    parts.length >= (item.totalParts ?? 1) &&
    parts.every((part) => part.completed)
  );
}
function percent(item: CourseProgress): number {
  if (item.manuallyCompleted) return 100;
  const parts = Object.values(item.parts);
  const total = parts.reduce((n, p) => n + p.durationSeconds, 0);
  return total
    ? Math.round(
        (parts.reduce(
          (n, p) => n + Math.min(p.maxPositionSeconds, p.durationSeconds),
          0,
        ) /
          total) *
          100,
      )
    : 0;
}
function bookmarkUrl(item: ClipBookmark): string {
  const url = new URL(item.url);
  url.searchParams.set("t", String(Math.floor(item.startSeconds)));
  url.searchParams.set("bse_pause", item.kind === "point" ? "1" : "0");
  if (item.endSeconds !== undefined) {
    url.searchParams.set("bse_a", String(item.startSeconds));
    url.searchParams.set("bse_b", String(item.endSeconds));
  }
  return url.toString();
}

function Options(): React.JSX.Element {
  const [view, setView] = useState<View>("features");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [bookmarks, setBookmarks] = useState<ClipBookmark[]>([]);
  const [progress, setProgress] = useState<CourseProgress[]>([]);
  const [session, setSession] = useState<LearningSession | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [newUrl, setNewUrl] = useState("");
  const [addingQueue, setAddingQueue] = useState(false);
  const [contentRuleDraft, setContentRuleDraft] = useState("");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryTag, setLibraryTag] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [pendingImport, setPendingImport] = useState<AppDataExport | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  async function load() {
    setLoadError("");
    const [a, b] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_USAGE_SUMMARY" }),
    ]);
    setSettings(a);
    setContentRuleDraft(a.contentFilter.keywords.join("\n"));
    setUsage(b);
    const [c, d, e, f] = await Promise.all([
      sendMessage({ type: "LIST_QUEUE" }),
      sendMessage({ type: "LIST_BOOKMARKS" }),
      sendMessage({ type: "LIST_PROGRESS" }),
      sendMessage({ type: "GET_LEARNING_SESSION" }),
    ]);
    setQueue(c);
    setBookmarks(d);
    setProgress(e);
    setSession(f);
  }
  useEffect(() => {
    void load().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "插件后台未响应";
      setLoadError(message);
      setNotice(message);
    });
  }, []);
  useEffect(() => {
    if (view !== "stats") return;
    let mounted = true;
    const refreshUsage = () =>
      void sendMessage({ type: "GET_USAGE_SUMMARY" })
        .then((next) => {
          if (mounted) setUsage(next);
        })
        .catch((error: unknown) => {
          if (mounted) showError(error);
        });
    refreshUsage();
    const timer = window.setInterval(refreshUsage, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [view]);
  const [, tickClock] = useState(0);
  useEffect(() => {
    if (view !== "learning") return;
    let alive = true;
    const update = () =>
      void sendMessage({ type: "GET_LEARNING_SESSION" })
        .then((value) => {
          if (alive) setSession(value);
        })
        .catch(showError);
    update();
    const timer = window.setInterval(() => {
      tickClock((v) => v + 1);
    }, 1000);
    const poll = window.setInterval(update, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(poll);
    };
  }, [view]);
  useEffect(() => {
    void checkSiteAccess(setNotice, false).catch(showError);
  }, []);
  const showError = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : "操作失败");
  async function patch(
    value: Parameters<typeof sendMessage<"PATCH_SETTINGS">>[0]["patch"],
  ) {
    if (
      value.features &&
      Object.values(value.features).some(Boolean) &&
      !(await checkSiteAccess(setNotice, true))
    )
      return;
    const next = await sendMessage({ type: "PATCH_SETTINGS", patch: value });
    setSettings(next);
  }
  async function toggleFeature(id: FeatureId) {
    if (!settings) return;
    if (
      !settings.features[id] &&
      !(await chrome.permissions.contains({
        origins: ["https://*.bilibili.com/*"],
      }))
    ) {
      setNotice("该功能需要B站网站访问权限，请在扩展详情中恢复后再开启。");
      return;
    }
    await patch({
      features: { ...settings.features, [id]: !settings.features[id] },
    });
  }
  async function saveFilterRules() {
    if (!settings) return;
    const contentRules = contentRuleDraft
      .split(/\n+/)
      .map((value) => value.trim())
      .filter(Boolean);
    await patch({
      contentFilter: { keywords: contentRules },
    });
    setContentRuleDraft(contentRules.join("\n"));
    setNotice("过滤规则已保存并重新应用");
  }
  async function updateQueue(id: string, value: Partial<QueueItem>) {
    await sendMessage({ type: "UPDATE_QUEUE_ITEM", id, patch: value });
    await load();
  }
  async function moveQueue(id: string, direction: -1 | 1) {
    const current = sortedQueue.find((item) => item.id === id);
    if (!current) return;
    const group = sortedQueue.filter((item) => item.status === current.status);
    const index = group.findIndex((item) => item.id === id);
    const target = index + direction;
    if (target < 0 || target >= group.length) return;
    [group[index], group[target]] = [group[target], group[index]];
    await Promise.all(
      group.map((item, sortOrder) =>
        sendMessage({
          type: "UPDATE_QUEUE_ITEM",
          id: item.id,
          patch: { sortOrder },
        }),
      ),
    );
    await load();
  }
  async function addUrl() {
    if (!(await checkSiteAccess(setNotice, true))) return;
    const raw = newUrl.trim();
    const url = /^BV[0-9a-z]+$/i.test(raw)
      ? `https://www.bilibili.com/video/${raw}`
      : raw;
    const bvid = parseBvid(url);
    const ep = parseCheeseEpisodeId(url);
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      // The common validation message below is clearer for the user.
    }
    if (
      !url.startsWith("https://") ||
      !(hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) ||
      (!bvid && !ep)
    )
      throw new Error("请粘贴普通BV视频或B站课堂链接");
    setAddingQueue(true);
    try {
      await sendMessage({
        type: "ADD_QUEUE_ITEM",
        item: {
          bvid,
          cheeseEpisodeId: ep,
          url,
          title: bvid ?? ep ?? "待识别视频",
          status: "later",
        },
      });
      setNewUrl("");
      await load();
    } finally {
      setAddingQueue(false);
    }
  }
  async function beginLearning() {
    if (!(await checkSiteAccess(setNotice, true))) return;
    if (
      !confirm(
        `二次确认：开始${minutes}分钟学习，期间不能修改视频、时长或提前退出？`,
      )
    )
      return;
    const next = await sendMessage({
      type: "START_LEARNING_SESSION",
      durationMinutes: minutes,
      queueItemIds: selected,
    });
    setSession(next);
    if (next.allowedVideos[0])
      await chrome.tabs.create({ url: next.allowedVideos[0].url });
  }
  async function exportData() {
    const data = await sendMessage({ type: "EXPORT_ALL_DATA" });
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bilibili-study-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  async function chooseImport(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as AppDataExport;
      if (parsed.schemaVersion !== 2) throw new Error("备份版本不兼容");
      setPendingImport(parsed);
    } catch (error) {
      showError(error);
    }
  }
  async function importNow() {
    if (!pendingImport) return;
    await sendMessage({ type: "IMPORT_ALL_DATA", data: pendingImport });
    setPendingImport(null);
    await load();
    setNotice("备份已安全覆盖当前数据");
  }
  async function clearSection(section: ClearableDataSection) {
    if (!confirm(`确定单独清空“${sectionLabels[section]}”？`)) return;
    await sendMessage({ type: "CLEAR_DATA_SECTION", section });
    await load();
  }
  async function clearAll() {
    if (
      !confirm("这会永久删除全部本地数据。是否继续？") ||
      !confirm("再次确认：删除后只能通过已有备份恢复。")
    )
      return;
    await sendMessage({ type: "CLEAR_ALL_DATA" });
    await load();
  }
  const locked = learningLocked(session);
  const remaining = learningRemaining(session);
  const soon = queue.filter((x) => x.status === "soon");
  const soonMinutes = soon.reduce(
    (n, x) => n + (x.durationSeconds ?? 0) / 60,
    0,
  );
  const overLimit = Boolean(
    settings &&
    (soon.length > settings.queue.soonSoftLimit ||
      soonMinutes > settings.queue.soonSoftMinutes),
  );
  const sortedQueue = useMemo(
    () =>
      [...queue].sort(
        (a, b) =>
          ["needs-review", "soon", "later", "completed"].indexOf(a.status) -
            ["needs-review", "soon", "later", "completed"].indexOf(b.status) ||
          (a.sortOrder !== undefined && b.sortOrder !== undefined
            ? a.sortOrder - b.sortOrder
            : (a.dueAt ?? 9e15) - (b.dueAt ?? 9e15)),
      ),
    [queue],
  );
  const filteredBookmarks = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    return bookmarks.filter(
      (item) =>
        (!libraryTag || item.tag === libraryTag) &&
        (!query ||
          `${item.name} ${item.title} ${item.uploader ?? ""} ${item.note ?? ""}`
            .toLowerCase()
            .includes(query)),
    );
  }, [bookmarks, libraryQuery, libraryTag]);
  if (!settings || !usage)
    return (
      <main className="loading-card">
        {loadError ? (
          <>
            <strong>插件后台启动失败</strong>
            <p>{loadError}</p>
            <button className="primary-button" onClick={() => void load()}>
              重新加载
            </button>
          </>
        ) : (
          "正在加载插件数据…"
        )}
      </main>
    );
  return (
    <main className="options-layout">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark">B</span>
          <div>
            <strong>B站综合插件</strong>
            <small>学习控制台</small>
          </div>
        </div>
        <nav className="side-nav">
          {(
            [
              ["features", "功能设置"],
              ["optimization", "界面优化"],
              ["stats", "观看统计"],
              ["queue", "观看队列"],
              ["learning", "学习模式"],
              ["library", "学习沉淀"],
              ["data", "数据管理"],
            ] as [View, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <p className="sidebar-note">
          新安装默认统计用时；无插件账户、无云同步。
        </p>
      </aside>
      <section className="content-area">
        {notice ? (
          <button className="feedback" onClick={() => setNotice("")}>
            {notice}
            <span>×</span>
          </button>
        ) : null}
        {view === "features" ? (
          <>
            <Header
              title="功能设置"
              text="观看统计在新安装时默认开启；学习模式和观看队列在各自页面使用。"
            />
            {!settings.onboardingComplete ? (
              <section className="onboarding-card">
                <div>
                  <strong>开始前请确认</strong>
                  <p>
                    数据只保存在本机，卸载扩展会删除这些数据，请先导出备份。
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => void patch({ onboardingComplete: true })}
                >
                  我知道了
                </button>
              </section>
            ) : null}
            <section className="feature-grid">
              {Object.entries(features)
                .filter(
                  ([id]) =>
                    ![
                      "learning-mode",
                      "watch-queue",
                      "interface-optimization",
                    ].includes(id),
                )
                .map(([id, label]) => (
                  <article className="feature-card" key={id}>
                    <div>
                      <h2>{label}</h2>
                      <p>启用后仅在对应B站页面生效。</p>
                    </div>
                    <label className="toggle-control">
                      <input
                        type="checkbox"
                        checked={settings.features[id as FeatureId]}
                        onChange={() => void toggleFeature(id as FeatureId)}
                      />
                      <span>
                        {settings.features[id as FeatureId]
                          ? "已开启"
                          : "已关闭"}
                      </span>
                    </label>
                  </article>
                ))}
            </section>
            <section className="settings-card">
              <h2>推荐内容设置</h2>
              <p>广告、直播、类型角标及营销视频，统一在界面优化中管理。</p>
              <button onClick={() => setView("optimization")}>
                打开界面优化
              </button>
            </section>
            <section className="settings-card">
              <h2>评论与弹幕过滤词</h2>
              <p>
                只过滤已加载的评论与弹幕，不读取其他视频评论。与首页标题关键词相互独立。
              </p>
              <label className="field">
                <span>每行一个词</span>
                <textarea
                  value={contentRuleDraft}
                  onChange={(e) => setContentRuleDraft(e.target.value)}
                />
              </label>
              <button onClick={() => void saveFilterRules().catch(showError)}>
                保存并应用
              </button>
            </section>
            <section className="settings-card">
              <h2>播放器快捷键</h2>
              <div className="form-grid">
                {Object.entries(settings.playerTools.shortcuts).map(
                  ([key, value]) => (
                    <label className="field" key={key}>
                      <span>
                        {{
                          setA: "设置A点",
                          setB: "设置B点",
                          clearLoop: "清除循环",
                          savePoint: "保存时间点",
                          saveSegment: "保存片段",
                        }[key] ?? key}
                      </span>
                      <input
                        value={value}
                        onChange={(e) =>
                          void patch({
                            playerTools: {
                              ...settings.playerTools,
                              shortcuts: {
                                ...settings.playerTools.shortcuts,
                                [key]: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
            </section>
          </>
        ) : null}
        {view === "stats" ? (
          <>
            <Header
              title="观看统计"
              text="本页每5秒刷新；总时长包含学习模式和直播，三项不能相加。"
            />
            <section className="metric-grid">
              <Metric
                label="今日总时长"
                value={duration(usage.today.totalSeconds)}
              />
              <Metric
                label="今日学习"
                value={duration(usage.today.studySeconds)}
              />
              <Metric
                label="今日直播"
                value={duration(usage.today.liveSeconds)}
              />
            </section>
            <section className="settings-card">
              <h2>近七天使用情况</h2>
              <UsageCharts days={usage.currentWeek} />
            </section>
            <section className="settings-card">
              <h2>月度累计</h2>
              <table>
                <tbody>
                  {usage.months.map((m) => (
                    <tr key={m.month}>
                      <th>{m.month}</th>
                      <td>总计 {duration(m.totalSeconds)}</td>
                      <td>学习 {duration(m.studySeconds)}</td>
                      <td>直播 {duration(m.liveSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : null}
        {view === "optimization" && settings ? (
          <FilterSettings
            settings={settings}
            patch={patch}
            showError={showError}
          />
        ) : null}
        {view === "queue" ? (
          <>
            <Header
              title="观看队列"
              text="独立的待观看清单，可放学习或娱乐视频；学习模式只使用你选中的视频。"
            />
            <div className="toolbar">
              <input
                placeholder="输入BV号、视频链接或B站课堂链接"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <button
                disabled={addingQueue}
                onClick={() => void addUrl().catch(showError)}
              >
                {addingQueue ? "正在获取视频信息…" : "加入稍后看"}
              </button>
            </div>
            {overLimit ? (
              <p className="alert">近期观看超过5个或3小时，仍可继续添加。</p>
            ) : null}
            <section className="list-card">
              {!sortedQueue.length && (
                <p>还没有待观看视频。粘贴链接加入，或在视频页点击“稍后看”。</p>
              )}
              {sortedQueue.map((item) => (
                <article className="queue-card" key={item.id}>
                  <button
                    className="queue-cover"
                    onClick={() => window.open(item.url, "_blank")}
                    aria-label={`打开${item.title}`}
                  >
                    {item.coverUrl ? (
                      <img
                        src={item.coverUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.hidden = true;
                        }}
                      />
                    ) : (
                      <span>暂无封面</span>
                    )}
                  </button>
                  <div className="queue-content">
                    <div className="queue-heading">
                      <span className={`status-tag status-tag--${item.status}`}>
                        {statusLabels[item.status]}
                      </span>
                      <h3>{item.title}</h3>
                    </div>
                    <p>
                      {item.uploader ?? "未获取UP主"} · 到期 {date(item.dueAt)}
                      {item.inaccessible ? " · 已标记失效" : ""}
                      {item.extensionCount >= 2 ? " · 已多次延期" : ""}
                    </p>
                    {item.note ? (
                      <p className="note-text">{item.note}</p>
                    ) : null}
                    <div className="queue-controls">
                      <button onClick={() => window.open(item.url, "_blank")}>
                        打开视频
                      </button>
                      <button
                        onClick={() =>
                          void sendMessage({
                            type: "REFRESH_QUEUE_METADATA",
                            id: item.id,
                          }).then(load)
                        }
                      >
                        更新信息
                      </button>
                      <select
                        value={item.status}
                        onChange={(e) =>
                          void updateQueue(item.id, {
                            status: e.target.value as QueueStatus,
                          })
                        }
                      >
                        {Object.entries(statusLabels).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={
                          item.dueAt
                            ? new Date(item.dueAt).toISOString().slice(0, 10)
                            : ""
                        }
                        onChange={(e) =>
                          void updateQueue(item.id, {
                            dueAt: new Date(
                              `${e.target.value}T23:59:59`,
                            ).getTime(),
                          })
                        }
                      />
                      <button
                        onClick={() =>
                          void updateQueue(item.id, {
                            dueAt: Date.now() + 7 * 86_400_000,
                            extensionCount: item.extensionCount + 1,
                            status: "soon",
                          })
                        }
                      >
                        延期7天
                      </button>
                      <button
                        onClick={() =>
                          void updateQueue(item.id, {
                            dueAt: Date.now() + 30 * 86_400_000,
                            extensionCount: item.extensionCount + 1,
                            status: "later",
                          })
                        }
                      >
                        延期30天
                      </button>
                      <button
                        onClick={() => {
                          const note = prompt("队列备注", item.note ?? "");
                          if (note !== null)
                            void updateQueue(item.id, { note });
                        }}
                      >
                        备注
                      </button>
                      <button
                        onClick={() =>
                          void updateQueue(item.id, {
                            inaccessible: !item.inaccessible,
                          })
                        }
                      >
                        {item.inaccessible ? "恢复可用" : "标记失效"}
                      </button>
                      <button onClick={() => void moveQueue(item.id, -1)}>
                        上移
                      </button>
                      <button onClick={() => void moveQueue(item.id, 1)}>
                        下移
                      </button>
                      <button
                        className="danger-link"
                        onClick={() =>
                          void sendMessage({
                            type: "DELETE_QUEUE_ITEM",
                            id: item.id,
                          }).then(load)
                        }
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}
        {view === "learning" ? (
          <>
            <Header
              title="严格学习模式"
              text="开始前选定视频和时长；目标时间结束前不能退出。"
            />
            {session?.active ? (
              <section className="settings-card">
                <h2>
                  {!learningLocked(session)
                    ? "已到设定时间，可以结束学习"
                    : `剩余 ${duration(remaining)}`}
                </h2>
                <p>{session.allowedVideos.map((x) => x.title).join("、")}</p>
                <button
                  disabled={learningLocked(session)}
                  onClick={() =>
                    void sendMessage({ type: "STOP_LEARNING_SESSION" }).then(
                      load,
                    )
                  }
                >
                  结束学习
                </button>
              </section>
            ) : (
              <section className="settings-card">
                <h2>选择本次学习视频（允许该视频的所有分P）</h2>
                {!queue.some((x) => x.status !== "completed") && (
                  <p>
                    请先在观看队列中添加视频。
                    <button onClick={() => setView("queue")}>
                      打开观看队列
                    </button>
                  </p>
                )}
                {queue
                  .filter((x) => x.status !== "completed")
                  .map((item) => (
                    <label className="toggle-row" key={item.id}>
                      <span>{item.title}</span>
                      <input
                        type="radio"
                        name="learning-video"
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected(e.target.checked ? [item.id] : [])
                        }
                      />
                    </label>
                  ))}
                <label className="field">
                  <span>学习时长（10–360分钟）</span>
                  <input
                    type="number"
                    min="10"
                    max="360"
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={!selected.length}
                  onClick={() => void beginLearning().catch(showError)}
                >
                  检查并二次确认
                </button>
                <p className="muted">
                  按真实时间到期；暂停视频、切到笔记软件不暂停倒计时。学习期间其他B站页面只允许返回所选视频。不限制其他网站或软件；停用或卸载扩展会使限制失效。
                </p>
              </section>
            )}
          </>
        ) : null}
        {view === "library" ? (
          <>
            <Header
              title="学习沉淀"
              text="只保存链接、时间戳和进度，不保存视频内容。"
            />
            <section className="settings-card">
              <h2>时间点与AB片段</h2>
              <div className="toolbar">
                <input
                  type="search"
                  placeholder="搜索名称、视频、UP主或备注"
                  value={libraryQuery}
                  onChange={(e) => setLibraryQuery(e.target.value)}
                />
                <select
                  value={libraryTag}
                  onChange={(e) => setLibraryTag(e.target.value)}
                >
                  <option value="">全部类型</option>
                  <option>重点</option>
                  <option>疑问</option>
                  <option>待复习</option>
                </select>
              </div>
              {filteredBookmarks.map((item) => (
                <article className="data-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <p>
                      {item.title} · {Math.floor(item.startSeconds)}秒
                    </p>
                  </div>
                  <div className="row-actions">
                    <button
                      onClick={() => window.open(bookmarkUrl(item), "_blank")}
                    >
                      跳转
                    </button>
                    <select
                      value={item.tag ?? ""}
                      onChange={(e) =>
                        void sendMessage({
                          type: "UPDATE_BOOKMARK",
                          id: item.id,
                          patch: {
                            tag: (e.target.value ||
                              undefined) as ClipBookmark["tag"],
                          },
                        }).then(load)
                      }
                    >
                      <option value="">未分类</option>
                      <option>重点</option>
                      <option>疑问</option>
                      <option>待复习</option>
                    </select>
                    <button
                      onClick={() => {
                        const name = prompt("名称", item.name);
                        if (name === null) return;
                        const note = prompt("备注", item.note ?? "");
                        if (note !== null)
                          void sendMessage({
                            type: "UPDATE_BOOKMARK",
                            id: item.id,
                            patch: { name, note },
                          }).then(load);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="danger-link"
                      onClick={() =>
                        void sendMessage({
                          type: "DELETE_BOOKMARK",
                          id: item.id,
                        }).then(load)
                      }
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))}
            </section>
            <section className="settings-card">
              <h2>课程进度</h2>
              {progress.map((item) => (
                <article className="data-row" key={item.key}>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {percent(item)}% · {Object.keys(item.parts).length}
                      个分P有记录
                    </p>
                  </div>
                  <div className="row-actions">
                    <button onClick={() => window.open(item.url, "_blank")}>
                      继续学习
                    </button>
                    <button
                      onClick={() =>
                        void sendMessage({
                          type: "UPDATE_PROGRESS",
                          progress: {
                            ...item,
                            manuallyCompleted: !courseComplete(item),
                            updatedAt: Date.now(),
                          },
                        }).then(load)
                      }
                    >
                      {courseComplete(item) ? "取消完成" : "标记完成"}
                    </button>
                    <button
                      className="danger-link"
                      onClick={() =>
                        void sendMessage({
                          type: "RESET_PROGRESS",
                          key: item.key,
                        }).then(load)
                      }
                    >
                      重置
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}
        {view === "data" ? (
          <>
            <Header
              title="数据管理"
              text="完整备份不包含Cookie、Token、视频文件或正在进行的学习会话。"
            />
            <section className="settings-card action-stack">
              <div>
                <h2>导出JSON备份</h2>
                <p>卸载扩展会删除本地数据，卸载前请先导出。</p>
              </div>
              <button onClick={() => void exportData().catch(showError)}>
                导出
              </button>
            </section>
            <section className="settings-card action-stack">
              <div>
                <h2>导入并覆盖</h2>
                <p>验证通过后覆盖设置、统计、队列、片段、进度和提醒。</p>
              </div>
              <button
                disabled={locked}
                onClick={() => inputRef.current?.click()}
              >
                选择备份
              </button>
              <input
                ref={inputRef}
                hidden
                type="file"
                accept="application/json"
                onChange={(e) => {
                  void chooseImport(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </section>
            {pendingImport ? (
              <section className="settings-card danger-card">
                <h2>导入预览</h2>
                <p>
                  将覆盖：功能设置、观看统计、{pendingImport.queue.length}
                  个队列项、{pendingImport.bookmarks.length}个片段、
                  {pendingImport.progress.length}个课程进度和
                  {pendingImport.notices.length}条提醒。
                </p>
                <div className="button-group">
                  <button onClick={() => setPendingImport(null)}>取消</button>
                  <button
                    className="danger-button"
                    onClick={() => void importNow().catch(showError)}
                  >
                    确认覆盖
                  </button>
                </div>
              </section>
            ) : null}
            <section className="settings-card">
              <h2>分项清空</h2>
              <p>每项只清空自己，不连带删除其他数据。</p>
              <div className="button-group wrap">
                {Object.entries(sectionLabels).map(([id, label]) => (
                  <button
                    key={id}
                    disabled={locked}
                    onClick={() =>
                      void clearSection(id as ClearableDataSection).catch(
                        showError,
                      )
                    }
                  >
                    清空{label}
                  </button>
                ))}
              </div>
            </section>
            <section className="settings-card danger-card">
              <h2>清空全部数据</h2>
              <button
                className="danger-button"
                disabled={locked}
                onClick={() => void clearAll().catch(showError)}
              >
                连续两次确认后清空
              </button>
              {locked ? <p>学习时间结束前只允许导出备份。</p> : null}
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
function Header({ title, text }: { title: string; text: string }) {
  return (
    <header className="page-header">
      <div className="section-title-row help-title">
        <h1>{title}</h1>
        <details className="help-popover">
          <summary aria-label={`${title}使用指南`}>?</summary>
          <div>
            <strong>使用指南</strong>
            <p>{text}</p>
            <p>
              {title === "观看队列"
                ? "添加后自动尝试获取标题与封面；失败时可点击更新信息重试。加入队列不会自动开始学习。"
                : title === "严格学习模式"
                  ? "先把视频加入观看队列，选择一个视频和时长，再二次确认。到期前不能通过插件提前结束；所有分P均允许。"
                  : title.includes("统计")
                    ? "主图展示近七天日度用时，点击日期查看该天时段。总时长已包含学习和直播，三者不能相加。"
                    : "开启对应功能后使用；设置仅保存在当前浏览器。网页尚未生效时，确认站点权限并刷新B站页面。"}
            </p>
          </div>
        </details>
      </div>
      <p>{text}</p>
    </header>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
const sumDay = (day: DailyUsageRecord) =>
  day.hours.reduce(
    (result, hour) => ({
      totalSeconds: result.totalSeconds + hour.totalSeconds,
      studySeconds: result.studySeconds + hour.studySeconds,
      liveSeconds: result.liveSeconds + hour.liveSeconds,
    }),
    { totalSeconds: 0, studySeconds: 0, liveSeconds: 0 },
  );

const weekday = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(
    new Date(`${value}T12:00:00`),
  );

function UsageCharts({ days }: { days: DailyUsageRecord[] }) {
  const today = new Date().toLocaleDateString("sv-SE");
  const [selectedDate, setSelectedDate] = useState(
    days.find((day) => day.date === today)?.date ?? days.at(-1)?.date ?? "",
  );
  const totals = days.map(sumDay);
  const dailyMax = Math.max(1, ...totals.map((item) => item.totalSeconds));
  const selected = days.find((day) => day.date === selectedDate) ?? days.at(-1);
  const hourlyMax = Math.max(
    1,
    ...(selected?.hours.map((hour) => hour.totalSeconds) ?? [1]),
  );
  return (
    <div className="usage-charts">
      <div className="chart-legend" aria-label="图例">
        <span className="total">总时长</span>
        <span className="study">学习</span>
        <span className="live">直播</span>
      </div>
      <div className="daily-chart" aria-label="近七天日度使用柱状图">
        {days.map((day, index) => {
          const value = totals[index];
          return (
            <button
              type="button"
              className={day.date === selected?.date ? "selected" : ""}
              key={day.date}
              onClick={() => setSelectedDate(day.date)}
              title={`${day.date}：总计${duration(value.totalSeconds)}，学习${duration(value.studySeconds)}，直播${duration(value.liveSeconds)}`}
            >
              <span className="daily-value">
                {duration(value.totalSeconds)}
              </span>
              <span className="bar-group">
                <i
                  className="total"
                  style={{
                    height: `${(value.totalSeconds / dailyMax) * 100}%`,
                  }}
                />
                <i
                  className="study"
                  style={{
                    height: `${(value.studySeconds / dailyMax) * 100}%`,
                  }}
                />
                <i
                  className="live"
                  style={{ height: `${(value.liveSeconds / dailyMax) * 100}%` }}
                />
              </span>
              <strong>{weekday(day.date)}</strong>
              <small>{day.date.slice(5)}</small>
            </button>
          );
        })}
      </div>
      {selected ? (
        <section className="hourly-detail">
          <div className="chart-heading">
            <div>
              <h3>{selected.date} 时段分布</h3>
              <p>点击上方日期可查看近七天任意一天</p>
            </div>
            <strong>{duration(sumDay(selected).totalSeconds)}</strong>
          </div>
          <div className="hourly-scroll">
            <div className="hourly-chart">
              {selected.hours.map((hour, index) => (
                <div
                  className="hour-column"
                  key={index}
                  title={`${index}:00 总计${duration(hour.totalSeconds)}，学习${duration(hour.studySeconds)}，直播${duration(hour.liveSeconds)}`}
                >
                  <span className="bar-group">
                    <i
                      className="total"
                      style={{
                        height: `${(hour.totalSeconds / hourlyMax) * 100}%`,
                      }}
                    />
                    <i
                      className="study"
                      style={{
                        height: `${(hour.studySeconds / hourlyMax) * 100}%`,
                      }}
                    />
                    <i
                      className="live"
                      style={{
                        height: `${(hour.liveSeconds / hourlyMax) * 100}%`,
                      }}
                    />
                  </span>
                  <small>{index % 3 === 0 ? `${index}时` : ""}</small>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Options />);
