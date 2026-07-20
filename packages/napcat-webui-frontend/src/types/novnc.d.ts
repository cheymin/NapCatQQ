declare module '@novnc/novnc' {
  export interface RFBOptions {
    shared?: boolean;
    credentials?: {
      username?: string;
      password?: string;
    };
    wsProtocols?: string[];
  }

  class RFB {
    constructor(
      target: HTMLElement | null,
      url: string,
      options?: RFBOptions
    );

    addEventListener(event: string, listener: (...args: any[]) => void): void;
    removeEventListener(event: string, listener: (...args: any[]) => void): void;

    disconnect(): void;
    scaleViewport(scale?: boolean): void;
    focus(): void;
    blur(): void;
  }

  export default RFB;
}