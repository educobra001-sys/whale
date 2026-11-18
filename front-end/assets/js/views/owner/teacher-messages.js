import { fullName } from "../../core/ui.js";
import { messagesScreen } from "../shared/messages.js";

// The owner writes and sends messages to one teacher's students, with every channel available.
export default async function ownerTeacherMessages(ctx) {
  const { api, params } = ctx;
  const teacher = await api.owner.teacher(params.id);
  return messagesScreen(ctx, api.owner.teacherMessages(params.id), {
    eyebrow: "Teacher",
    title: `Messages · ${fullName(teacher)}`,
    text: "Write a message for this teacher's students or parents. It's signed with the teacher's details and sent from the teacher's own WhatsApp number when one is linked.",
    backLink: `#/teachers/${encodeURIComponent(params.id)}`,
  });
}
