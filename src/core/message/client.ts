import type {
  ExtensionMessage,
  MessageResponse,
  MessageResponseMap,
  MessageType,
} from "../types/messages";
export async function sendMessage<T extends MessageType>(
  message: Extract<ExtensionMessage, { type: T }>,
): Promise<MessageResponseMap[T]> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as MessageResponse<T>;
  if (!response?.ok)
    throw new Error(response?.error.message ?? "插件后台未响应");
  return response.data;
}
