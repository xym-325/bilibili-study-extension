export async function getStored<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}
export async function setStored<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}
export async function clearStored(): Promise<void> {
  await chrome.storage.local.clear();
}
