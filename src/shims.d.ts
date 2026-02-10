export {};

declare global {
  interface Window {
    electronAPI: {
      sendMessage: (message: string) => void;
      uploadVideosToBaidu: (payload: {rows: any[]; accessToken: string} | any[]) => Promise<any>;
      onUploadVideosToBaiduProgress: (listener: (payload: any) => void) => () => void;
    };
  }
}

declare module 'xlsx';
