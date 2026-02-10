export {};

declare global {
  interface Window {
    electronAPI: {
      sendMessage: (message: string) => void;
      uploadVideosToBaidu: (rows: any[]) => Promise<any>;
      onUploadVideosToBaiduProgress: (listener: (payload: any) => void) => () => void;
    };
  }
}

declare module 'xlsx';
