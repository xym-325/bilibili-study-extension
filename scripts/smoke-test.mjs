import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const manifest = JSON.parse(
  await readFile(resolve(dist, "manifest.json"), "utf8"),
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const file = (path) => access(resolve(dist, path));
assert(manifest.manifest_version === 3, "必须使用Manifest V3");
for (const permission of ["storage", "alarms", "tabs", "idle"])
  assert(manifest.permissions.includes(permission), `缺少权限：${permission}`);
assert(
  manifest.host_permissions.includes("https://*.bilibili.com/*"),
  "缺少B站子域名权限",
);
await file(manifest.background.service_worker);
await file(manifest.action.default_popup);
await file(manifest.options_page);
for (const script of manifest.content_scripts[0].js) await file(script);
console.log(
  "Smoke test passed: Manifest、后台、Popup、Options和内容脚本均可加载。",
);
