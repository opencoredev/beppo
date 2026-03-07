export type ElectrobunConfig = any;

export const BrowserWindow: {
  new (options: any): {
    id: number;
    webview: {
      on: (eventName: string, listener: (...args: any[]) => void) => void;
      openDevTools: () => void;
      sendMessageToWebviewViaExecute: (message: unknown) => void;
      rpcHandler?: ((message: unknown) => void) | undefined;
    };
    setTitle: (title: string) => void;
    focus: () => void;
  };
};

export const ApplicationMenu: {
  setApplicationMenu: (items: any[]) => void;
  on: (eventName: string, listener: (event: unknown) => void | Promise<void>) => void;
};

export const ContextMenu: {
  showContextMenu: (items: any[]) => void;
  on: (eventName: string, listener: (event: unknown) => void) => void;
};

export const Updater: {
  localInfo: {
    channel: () => Promise<string>;
  };
  channelBucketUrl: () => Promise<string>;
  updateInfo: () => { version?: string } | null;
  checkForUpdate: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  applyUpdate: () => Promise<void>;
  onStatusChange: (listener: (entry: unknown) => void) => void;
};

export const Utils: {
  openFileDialog: (options: any) => Promise<unknown>;
  showMessageBox: (options: any) => Promise<{ response: number }>;
  openExternal: (url: string) => boolean | Promise<boolean>;
  quit: () => void;
};

declare const Electrobun: {
  events: {
    on: (eventName: string, listener: (event: unknown) => void) => void;
  };
};

export default Electrobun;
