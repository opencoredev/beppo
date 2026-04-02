export const APP_BASE_NAME = "Beppo";
export const IS_DEV_STAGE = import.meta.env.DEV;
export const APP_STAGE_LABEL = IS_DEV_STAGE ? "Dev" : "Alpha";
export const APP_DISPLAY_NAME = `${APP_BASE_NAME} (${APP_STAGE_LABEL})`;
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
