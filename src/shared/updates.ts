export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'up-to-date' | 'error';

export interface UpdateStatus {
  phase: UpdatePhase;
  version?: string;
  progress?: number;
  message?: string;
  checkedAt?: number;
  autoCheck: boolean;
}

export type UpdateSignal =
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'progress'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };

export function initialUpdateStatus(autoCheck: boolean): UpdateStatus {
  return { phase: 'idle', autoCheck };
}

export function nextUpdateStatus(current: UpdateStatus, signal: UpdateSignal, at: number): UpdateStatus {
  const autoCheck = current.autoCheck;
  switch (signal.kind) {
    case 'checking':
      return { phase: 'checking', autoCheck };
    case 'available':
      return { phase: 'available', version: signal.version, autoCheck, checkedAt: at };
    case 'progress':
      return { phase: 'downloading', version: current.version, progress: Math.max(0, Math.min(100, Math.round(signal.percent))), autoCheck, checkedAt: current.checkedAt };
    case 'downloaded':
      return { phase: 'downloaded', version: signal.version, progress: 100, autoCheck, checkedAt: current.checkedAt };
    case 'none':
      return { phase: 'up-to-date', autoCheck, checkedAt: at };
    case 'error':
      return { phase: 'error', message: signal.message, autoCheck, checkedAt: at };
  }
}

export function shouldAutoCheck(autoCheck: boolean, packaged: boolean): boolean {
  return autoCheck && packaged;
}

/** An installed build only has something to check when electron-builder wrote its feed file. */
export function updatesConfigured(packaged: boolean, feed: boolean): boolean {
  return packaged && feed;
}
