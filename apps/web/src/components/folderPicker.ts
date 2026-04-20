type FolderPickerApi =
  | {
      dialogs: {
        pickFolder: () => Promise<string | null>;
      };
    }
  | null
  | undefined;

interface FolderPickerFeedback {
  title: string;
  description: string;
}

interface PickFolderWithFeedbackInput {
  api: FolderPickerApi;
  onError: (feedback: FolderPickerFeedback) => void;
}

function formatFolderPickerError(error: unknown): FolderPickerFeedback {
  return {
    title: "Could not open folder picker",
    description:
      error instanceof Error ? error.message : "An unexpected error occurred while opening it.",
  };
}

export async function pickFolderWithFeedback(input: PickFolderWithFeedbackInput) {
  if (!input.api) {
    input.onError({
      title: "Folder picker unavailable",
      description: "The desktop bridge is not ready yet. Try again in a moment.",
    });
    return null;
  }

  try {
    return await input.api.dialogs.pickFolder();
  } catch (error) {
    input.onError(formatFolderPickerError(error));
    return null;
  }
}
