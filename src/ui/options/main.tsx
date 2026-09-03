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

type View = "features" | "stats" | "queue" | "learning" | "library" | "data";
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
  later: "稍后看池",
  soon: "近期学习",
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
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryTag, setLibraryTag] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingImport, setPendingImport] = useState<AppDataExport | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  async function load() {
    const [a, b, c, d, e, f] = await Promise.all([
      sendMessage({ type: "GET_SETTINGS" }),
      sendMessage({ type: "GET_USAGE_SUMMARY" }),
      sendMessage({ type: "LIST_QUEUE" }),
      sendMessage({ type: "LIST_BOOKMARKS" }),
      sendMessage({ type: "LIST_PROGRESS" }),
      sendMessage({ type: "GET_LEARNING_SESSION" }),
    ]);
    setSettings(a);
    setUsage(b);
    setQueue(c);
    setBookmarks(d);
    setProgress(e);
    setSession(f);
  }
  useEffect(() => {
    void load().catch(showError);
  }, []);
  const showError = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : "操作失败");
  async function patch(
    value: Parameters<typeof sendMessage<"PATCH_SETTINGS">>[0]["patch"],
  ) {
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
    const url = newUrl.trim();
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
  }
  async function beginLearning() {
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
  const locked = Boolean(session?.active && !session.completed);
  const remaining = session
    ? Math.max(0, session.targetSeconds - session.elapsedSeconds)
    : 0;
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
    return <main className="loading-card">正在加载插件数据…</main>;
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
        <p className="sidebar-note">七项功能默认关闭；无插件账户、无云同步。</p>
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
              text="所有功能默认关闭，可以按需单独开启。"
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
              {Object.entries(features).map(([id, label]) => (
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
                      {settings.features[id as FeatureId] ? "已开启" : "已关闭"}
                    </span>
                  </label>
                </article>
              ))}
            </section>
            <section className="settings-card">
              <h2>界面与过滤规则</h2>
              <div className="form-grid">
                <label className="toggle-row">
                  <span>收起明确广告卡片</span>
                  <input
                    type="checkbox"
                    checked={settings.interfaceOptimization.hideAds}
                    onChange={(e) =>
                      void patch({
                        interfaceOptimization: {
                          ...settings.interfaceOptimization,
                          hideAds: e.target.checked,
                        },
                      })
                    }
                  />
                </label>
                <label className="toggle-row">
                  <span>收起直播推荐卡片</span>
                  <input
                    type="checkbox"
                    checked={settings.interfaceOptimization.hideLiveCards}
                    onChange={(e) =>
                      void patch({
                        interfaceOptimization: {
                          ...settings.interfaceOptimization,
                          hideLiveCards: e.target.checked,
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>隐藏视频类型标签（逗号分隔）</span>
                  <input
                    value={settings.interfaceOptimization.hiddenBadges.join(
                      ",",
                    )}
                    onChange={(e) =>
                      void patch({
                        interfaceOptimization: {
                          ...settings.interfaceOptimization,
                          hiddenBadges: e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>不和谐内容关键词（每行一个）</span>
                  <textarea
                    value={settings.contentFilter.keywords.join("\n")}
                    onChange={(e) =>
                      void patch({
                        contentFilter: {
                          keywords: e.target.value
                            .split(/\n/)
                            .map((x) => x.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
              </div>
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
              text="总时长包含学习模式和直播，三项不能相加。"
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
              <h2>本周小时热力图</h2>
              <Heatmap days={usage.currentWeek} />
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
        {view === "queue" ? (
          <>
            <Header
              title="观看队列"
              text="B站收藏负责长期保存，插件队列只负责什么时候看。"
            />
            <div className="toolbar">
              <input
                placeholder="粘贴BV视频或B站课堂链接"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
              <button onClick={() => void addUrl().catch(showError)}>
                加入稍后看
              </button>
            </div>
            {overLimit ? (
              <p className="alert">近期学习超过5个或3小时，仍可继续添加。</p>
            ) : null}
            <section className="list-card">
              {sortedQueue.map((item) => (
                <article className="data-row" key={item.id}>
                  <div className="data-main">
                    <span className={`status-tag status-tag--${item.status}`}>
                      {statusLabels[item.status]}
                    </span>
                    <h3>{item.title}</h3>
                    <p>
                      {item.uploader ?? "未获取UP主"} · 到期 {date(item.dueAt)}
                      {item.inaccessible ? " · 已标记失效" : ""}
                      {item.extensionCount >= 2 ? " · 已多次延期" : ""}
                    </p>
                    {item.note ? (
                      <p className="note-text">{item.note}</p>
                    ) : null}
                  </div>
                  <div className="row-actions">
                    <button onClick={() => window.open(item.url, "_blank")}>
                      打开
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
                        if (note !== null) void updateQueue(item.id, { note });
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
                      删除队列项
                    </button>
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
                  {session.completed
                    ? "目标时间已完成"
                    : `剩余 ${duration(remaining)}`}
                </h2>
                <p>{session.allowedVideos.map((x) => x.title).join("、")}</p>
                <button
                  disabled={!session.completed}
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
                <h2>选择本次学习视频</h2>
                {queue
                  .filter((x) => x.status !== "completed")
                  .map((item) => (
                    <label className="toggle-row" key={item.id}>
                      <span>{item.title}</span>
                      <input
                        type="checkbox"
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, item.id]
                              : selected.filter((id) => id !== item.id),
                          )
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
                  disabled={
                    !selected.length || !settings.features["learning-mode"]
                  }
                  onClick={() => void beginLearning().catch(showError)}
                >
                  检查并二次确认
                </button>
                {!settings.features["learning-mode"] ? (
                  <p>请先在功能设置中开启学习模式。</p>
                ) : null}
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
      <h1>{title}</h1>
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
function Heatmap({ days }: { days: DailyUsageRecord[] }) {
  const max = Math.max(
    1,
    ...days.flatMap((d) => d.hours.map((h) => h.totalSeconds)),
  );
  return (
    <div className="heatmap">
      {days.map((day) => (
        <div className="heatmap-row" key={day.date}>
          <strong>{day.date.slice(5)}</strong>
          <div>
            {day.hours.map((hour, i) => (
              <span
                key={i}
                title={`${i}:00 总计${duration(hour.totalSeconds)}，学习${duration(hour.studySeconds)}，直播${duration(hour.liveSeconds)}`}
                style={{ opacity: 0.12 + (0.88 * hour.totalSeconds) / max }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Options />);
