export type FinishAlert = 'notification' | 'sound' | 'none';

export interface FinishAlertOptions {
  notifications: boolean;
  sound: boolean;
  focused: boolean;
  supported: boolean;
}

export function finishAlert(options: FinishAlertOptions): FinishAlert {
  if (options.notifications && !options.focused && options.supported) return 'notification';
  return options.sound ? 'sound' : 'none';
}
