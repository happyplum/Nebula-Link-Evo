import { useControlStore, type ConsoleMessage } from '../store/control.store.js';

export function appendConsoleMessage(type: string, text: string): void {
  const message: ConsoleMessage = {
    type,
    text,
    timestamp: Date.now(),
  };

  useControlStore.getState().addConsoleMessage(message);
}
