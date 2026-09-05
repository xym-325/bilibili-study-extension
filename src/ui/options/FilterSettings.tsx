import React, { useEffect, useRef, useState } from "react";
import {
  CONTENT_TYPES,
  normalizeKeywords,
  type FilterReport,
} from "../../core/filter/rules";
import { sendMessage } from "../../core/message/client";
import type { AppSettings, SettingsPatch } from "../../core/types/settings";

type Panel = "types" | "marketing" | "keywords" | "history" | null;
export function FilterSettings({
  settings,
  patch,
  showError,
}: {
  settings: AppSettings;
  patch: (patch: SettingsPatch) => Promise<void>;
  showError: (error: unknown) => void;
}) {
  const opt = settings.interfaceOptimization;
  const [panel, setPanel] = useState<Panel>(null);
  const [draft, setDraft] = useState(opt.hiddenBadges.join("\n"));
  const [mode, setMode] = useState(opt.matchMode);
  const [pages, setPages] = useState<
    { id: number; title: string; url: string }[]
  >([]);
  const [tabId, setTabId] = useState<number>();
  const [report, setReport] = useState<FilterReport | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (panel) dialog.current?.showModal();
    else dialog.current?.close();
  }, [panel]);
  async function update(value: Partial<AppSettings["interfaceOptimization"]>) {
    setSaving(true);
    try {
      await patch({ interfaceOptimization: value });
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }
  async function refresh(id = tabId) {
    setBusy(true);
    setStatus("");
    setReport(null);
    try {
      const list = await sendMessage({ type: "GET_FILTER_PAGES" });
      setPages(list);
      const target =
        list.find((p) => p.id === id) ??
        list.find((p) => new URL(p.url).pathname === "/") ??
        list[0];
      if (!target) {
        setStatus("尚未找到B站页面，请先打开首页。");
        return;
      }
      setTabId(target.id);
      const next = await sendMessage({
        type: "GET_FILTER_REPORT",
        tabId: target.id,
      });
      if (!next?.counts)
        throw new Error("页面仍运行旧版脚本，请刷新该B站页面后重试。");
      setReport(next);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "无法读取页面状态");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  function openKeywords() {
    setDraft(opt.hiddenBadges.join("\n"));
    setMode(opt.matchMode);
    setPanel("keywords");
  }
  async function saveKeywords() {
    setSaving(true);
    try {
      await patch({
        interfaceOptimization: {
          hiddenBadges: normalizeKeywords(draft),
          matchMode: mode,
        },
      });
      setPanel(null);
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }
  async function restore(key: string) {
    if (tabId === undefined) return;
    setSaving(true);
    try {
      await sendMessage({ type: "RESTORE_FILTER_CARD", tabId, key });
      // Fetch the merged settings so reopening this panel won't lose the exception.
      await patch({});
      await refresh();
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <header className="page-header">
        <div className="section-title-row help-title">
          <h1>界面优化</h1>
          <details className="help-popover">
            <summary aria-label="界面优化使用指南">?</summary>
            <div>
              <strong>使用指南</strong>
              <p>
                开启界面优化，再选择想隐藏的内容。开关和类别立即保存；关键词编辑完成后点击“保存并应用”。
              </p>
              <p>
                仅调整本机页面。隐藏完整卡片后，其余已加载推荐自动补位，不额外请求推荐、评论或视频。
              </p>
              <p>
                判断不明的内容保留。被误屏蔽的视频可在记录中恢复，并加入本地例外名单。
              </p>
            </div>
          </details>
        </div>
        <p>保留导航与正常视频，只隐藏你选择的推荐内容。</p>
      </header>
      <section className="settings-card filtering-card">
        <label className="filter-setting">
          <span>
            <strong>启用界面优化</strong>
            <small>开关关闭时，下方规则仍会保留。</small>
          </span>
          <input
            aria-label="启用界面优化"
            type="checkbox"
            checked={settings.features["interface-optimization"]}
            disabled={saving}
            onChange={(e) => {
              setSaving(true);
              void patch({
                features: {
                  ...settings.features,
                  "interface-optimization": e.target.checked,
                },
              })
                .catch(showError)
                .finally(() => setSaving(false));
            }}
          />
        </label>
        <h2>屏蔽内容</h2>
        <label className="filter-setting">
          <span>
            <strong>平台广告</strong>
            <small>识别卡片上的明确广告标记；不因标题出现“广告”就屏蔽。</small>
          </span>
          <input
            type="checkbox"
            checked={opt.hideAds}
            disabled={saving}
            onChange={(e) => void update({ hideAds: e.target.checked })}
          />
        </label>
        <label className="filter-setting">
          <span>
            <strong>直播推荐</strong>
            <small>隐藏直播卡片及指向直播间的推荐。</small>
          </span>
          <input
            type="checkbox"
            checked={opt.hideLiveCards}
            disabled={saving}
            onChange={(e) => void update({ hideLiveCards: e.target.checked })}
          />
        </label>
        <div className="filter-setting">
          <span>
            <strong>指定内容类型</strong>
            <small>只匹配类型角标，不把普通视频标题当作类型。</small>
          </span>
          <button onClick={() => setPanel("types")}>
            已选 {opt.hiddenTypes.length} 类 · 选择类别 ›
          </button>
        </div>
        <div className="filter-setting">
          <span>
            <strong>明显营销视频</strong>
            <small>明确商品跳转，或标题同时包含销售对象与购买引导。</small>
          </span>
          <div className="filter-actions">
            <input
              aria-label="屏蔽明显营销视频"
              type="checkbox"
              checked={opt.hideMarketing}
              disabled={saving}
              onChange={(e) => void update({ hideMarketing: e.target.checked })}
            />
            <button onClick={() => setPanel("marketing")}>识别范围 ›</button>
          </div>
        </div>
        <div className="filter-setting">
          <span>
            <strong>自定义关键词</strong>
            <small>仅匹配视频标题；支持任意一个或同时包含全部关键词。</small>
          </span>
          <button onClick={openKeywords}>
            {opt.hiddenBadges.length} 个词 · 编辑规则 ›
          </button>
        </div>
        <p className="filter-note">
          小火箭、粉丝数、播放量均不单独触发屏蔽。正常视频的赞助、品牌植入不属于本功能的直接屏蔽依据。
        </p>
      </section>
      <section className="settings-card">
        <div className="section-title-row">
          <h2>页面屏蔽结果</h2>
          <button disabled={busy} onClick={() => void refresh()}>
            {busy ? "读取中…" : "刷新结果"}
          </button>
        </div>
        {pages.length > 0 && (
          <label className="field">
            <span>查看哪个B站页面</span>
            <select
              value={tabId ?? ""}
              disabled={busy}
              onChange={(e) => void refresh(Number(e.target.value))}
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} · {p.id}
                </option>
              ))}
            </select>
          </label>
        )}
        {status && (
          <p role="status" className="alert">
            {status}
          </p>
        )}
        {report && (
          <>
            <p>
              {report.enabled
                ? `已检查当前页面 ${report.checked} 张卡片`
                : "该页面未启用推荐过滤或不在支持范围内"}
            </p>
            <div className="filter-counts">
              {Object.entries(report.counts).map(([label, count]) => (
                <span key={label}>
                  {label} <strong>{count}</strong>
                </span>
              ))}
            </div>
            <p className="muted">
              数字表示实际隐藏的卡片，不代表平台本次推送总量；0不能证明识别规则已覆盖全部情况。
            </p>
          </>
        )}
        <button
          onClick={() => {
            setPanel("history");
            void refresh();
          }}
        >
          查看最近屏蔽 / 管理例外
        </button>
      </section>
      <dialog
        className="filter-drawer"
        ref={dialog}
        onCancel={() => setPanel(null)}
        onClose={() => setPanel(null)}
        aria-labelledby="filter-panel-title"
      >
        <div className="drawer-heading">
          <h2 id="filter-panel-title">
            {panel === "types"
              ? "选择内容类型"
              : panel === "marketing"
                ? "明显营销的识别范围"
                : panel === "keywords"
                  ? "自定义标题关键词"
                  : "最近屏蔽与例外"}
          </h2>
          <button aria-label="关闭侧栏" onClick={() => setPanel(null)}>
            关闭 ×
          </button>
        </div>
        {panel === "types" && (
          <>
            <p>各类别独立选择，修改立即保存。</p>
            <div className="filter-type-grid">
              {CONTENT_TYPES.map((type) => (
                <label key={type}>
                  <input
                    type="checkbox"
                    checked={opt.hiddenTypes.includes(type)}
                    disabled={saving}
                    onChange={(e) =>
                      void update({
                        hiddenTypes: e.target.checked
                          ? [...opt.hiddenTypes, type]
                          : opt.hiddenTypes.filter((t) => t !== type),
                      })
                    }
                  />
                  {type}
                </label>
              ))}
            </div>
            <p className="muted">
              这是目前已确认的九类，不代表B站未来不会新增角标。未识别的角标保留，不猜测分类。
            </p>
          </>
        )}
        {panel === "marketing" && (
          <>
            <p>这是判断规则说明，无需逐项配置。</p>
            <ul className="filter-explanation">
              <li>
                <strong>屏蔽：</strong>
                明确商品详情链接或“立即购买、立即下单”等购买按钮。
              </li>
              <li>
                <strong>屏蔽：</strong>
                “AI训练营限时报名”等销售对象与购买引导同时出现的标题。
              </li>
              <li>
                <strong>保留：</strong>
                只有小火箭、普通外链、活动链接或正常赞助内容。
              </li>
              <li>
                <strong>保留：</strong>
                “保健品骗局分析”“AI课程学习心得”等讨论、教学或避坑内容。
              </li>
              <li>
                <strong>无法确认则保留：</strong>
                只在置顶评论或视频中卖课的内容。
              </li>
            </ul>
            <p className="filter-note">
              不批量查询评论、不识别封面、不调用外部AI。普通小程序链接或第三方链接本身不等于广告。
            </p>
          </>
        )}
        {panel === "keywords" && (
          <>
            <label className="field">
              <span>关键词（每行一个，也可用逗号分隔）</span>
              <textarea
                rows={8}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="例如：娱乐资讯&#10;事件"
              />
            </label>
            <label className="field">
              <span>匹配方式</span>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as "any" | "all")}
              >
                <option value="any">包含任意一个关键词</option>
                <option value="all">同时包含全部关键词</option>
              </select>
            </label>
            <p className="muted">
              只按普通文字匹配，不支持正则表达式。空行不参与匹配；最多保存100个关键词。
            </p>
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void saveKeywords()}
            >
              保存并应用
            </button>
          </>
        )}
        {panel === "history" && (
          <>
            <p>
              当前所选页面最近隐藏的卡片（最多100条）；刷新网页后重新统计，不保存浏览历史。
            </p>
            {report?.hidden.length ? (
              report.hidden.map((record, i) => (
                <article
                  className="filter-history-item"
                  key={`${record.key}-${i}`}
                >
                  <strong>{record.title}</strong>
                  <p>
                    {record.reason} · {record.detail}
                  </p>
                  <button
                    disabled={saving}
                    onClick={() => void restore(record.key)}
                  >
                    恢复此视频，以后不再屏蔽
                  </button>
                </article>
              ))
            ) : (
              <p>暂无可显示的屏蔽记录。</p>
            )}
            <h3>本地例外（{opt.exceptions.length}）</h3>
            <p className="muted">只保存恢复的视频标识，不屏蔽整个UP主。</p>
            {opt.exceptions.map((key) => (
              <div className="exception-row" key={key}>
                <code>{key}</code>
                <button
                  disabled={saving}
                  onClick={() =>
                    void update({
                      exceptions: opt.exceptions.filter((k) => k !== key),
                    })
                  }
                >
                  移除例外
                </button>
              </div>
            ))}
          </>
        )}
      </dialog>
    </>
  );
}
