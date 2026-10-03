export class FakeSessionEventWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSessionEventWebSocket[] = [];

  readonly url: string;
  readonly sent: string[] = [];
  readyState = FakeSessionEventWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSessionEventWebSocket.instances.push(this);
  }

  static reset() {
    FakeSessionEventWebSocket.instances = [];
  }

  open() {
    this.readyState = FakeSessionEventWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(data: string) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  disconnect(code = 1006) {
    this.readyState = FakeSessionEventWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code }));
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = FakeSessionEventWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}
