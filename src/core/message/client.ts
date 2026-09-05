import type {
  ExtensionMessage,
  MessageResponse,
  MessageResponseMap,
  MessageType,
} from "../types/messages";
export async function sendMessage<T extends MessageType>(
  message: Extract<ExtensionMessage, { type: T }>,
): Promise<MessageResponseMap[T]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error("插件后台响应超时，请重新加载扩展并刷新B站页面后重试"),
        ),
      12000,
    );
  });
  let response: MessageResponse<T>;
  try {
    response = (await Promise.race([
      chrome.runtime.sendMessage(message),
      timeout,
    ])) as MessageResponse<T>;
  } finally {
    clearTimeout(timer);
  }
  if (!response?.ok)
    throw new Error(response?.error.message ?? "插件后台未响应");
  return response.data;
}
