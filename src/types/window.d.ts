export interface IYogi {
  connectBrowser: () => Promise<any>;
  sendChatMessage: (prompt: string, tier: string, workflow: string) => Promise<any>;
  executeTerminal: (command: string) => Promise<any>;
  getQuotas: () => Promise<any>;
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<any>;
  onTerminalOutput: (callback: (data: any) => void) => void;
}

declare global {
  interface Window {
    yogi: IYogi;
  }
}
