const origin = "https://*.bilibili.com/*";
const warningKey = "bse.permission-warning-shown";
export async function checkSiteAccess(
  notify: (message: string) => void,
  userAction: boolean,
): Promise<boolean> {
  const access = await chrome.permissions.contains({ origins: [origin] });
  const stored = await chrome.storage.local.get(warningKey);
  if (access) {
    if (stored[warningKey])
      await chrome.storage.local.set({ [warningKey]: false });
    return true;
  }
  if (userAction || !stored[warningKey]) {
    notify(
      "缺少B站网站访问权限。请在浏览器扩展详情中允许访问B站，再刷新B站页面；无需授予其他网站权限。",
    );
    await chrome.storage.local.set({ [warningKey]: true });
  }
  return false;
}
