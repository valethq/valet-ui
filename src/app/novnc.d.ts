declare module "@novnc/novnc" {
  export interface RfbOptions {
    shared?: boolean;
    credentials?: { username?: string; password?: string; target?: string };
    repeaterID?: string;
    wsProtocols?: string[];
  }

  export interface RfbEvent {
    detail?: { clean?: boolean; reason?: string };
  }

  export default class RFB {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RfbOptions);
    background: string;
    clipViewport: boolean;
    focusOnClick: boolean;
    resizeSession: boolean;
    scaleViewport: boolean;
    viewOnly: boolean;
    disconnect(): void;
    addEventListener(type: string, listener: (event: RfbEvent) => void): void;
    removeEventListener(type: string, listener: (event: RfbEvent) => void): void;
  }
}
