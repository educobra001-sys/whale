import { messagesScreen } from "../shared/messages.js";

export default async function messages(ctx) {
  const { api } = ctx;
  return messagesScreen(ctx, {
    config: () => api.teacher.messageConfig(),
    sessions: () => api.teacher.messageSessions(),
    saveTemplate: (type, body) => api.teacher.saveMessageTemplate(type, body),
    preview: (body) => api.teacher.previewMessages(body),
    previewOne: (body) => api.teacher.previewMessage(body),
    send: (body) => api.teacher.sendMessages(body),
    checkNumbers: (phones) => api.teacher.checkMessageNumbers(phones),
    report: (itemId, status) => api.teacher.reportMessage(itemId, status),
    batches: () => api.teacher.messageBatches(),
    batch: (batchId) => api.teacher.messageBatch(batchId),
  });
}
