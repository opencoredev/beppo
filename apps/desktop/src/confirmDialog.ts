import { Utils } from "./electrobun-runtime";

const CONFIRM_BUTTON_INDEX = 1;

export async function showDesktopConfirmDialog(message: string): Promise<boolean> {
  const normalizedMessage = message.trim();
  if (normalizedMessage.length === 0) {
    return false;
  }

  const result = await Utils.showMessageBox({
    type: "question" as const,
    buttons: ["No", "Yes"],
    defaultId: CONFIRM_BUTTON_INDEX,
    cancelId: 0,
    message: normalizedMessage,
  });
  return result.response === CONFIRM_BUTTON_INDEX;
}
