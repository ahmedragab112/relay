import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/contracts.js';
import { initialUpdateStatus, nextUpdateStatus, shouldAutoCheck, updatesConfigured, type UpdateSignal } from '../shared/updates.js';

const LAUNCH_CHECK_DELAY = 20_000;

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class Updates {
  private status: UpdateStatus = initialUpdateStatus(true);
  private started = false;

  constructor(private readonly publish: (status: UpdateStatus) => void) {}

  get current(): UpdateStatus {
    return this.status;
  }

  start(autoCheck: boolean): void {
    this.status = initialUpdateStatus(autoCheck);
    if (this.started) return;
    this.started = true;
    // The user decides when to download; installed updates still apply on quit.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => this.signal({ kind: 'checking' }));
    autoUpdater.on('update-available', (info) => this.signal({ kind: 'available', version: info.version }));
    autoUpdater.on('update-not-available', () => this.signal({ kind: 'none' }));
    autoUpdater.on('download-progress', (progress) => this.signal({ kind: 'progress', percent: progress.percent }));
    autoUpdater.on('update-downloaded', (info) => this.signal({ kind: 'downloaded', version: info.version }));
    autoUpdater.on('error', (error) => this.signal({ kind: 'error', message: reason(error) }));
    if (!shouldAutoCheck(autoCheck, this.configured())) return;
    const timer = setTimeout(() => { void this.check(false); }, LAUNCH_CHECK_DELAY);
    timer.unref();
  }

  setAutoCheck(enabled: boolean): UpdateStatus {
    this.status = { ...this.status, autoCheck: enabled };
    return this.status;
  }

  async check(manual: boolean): Promise<UpdateStatus> {
    if (!this.configured()) {
      if (manual) this.signal({ kind: 'error', message: app.isPackaged ? 'No update feed is configured for this build.' : 'Update checks run in installed builds only.' });
      return this.status;
    }
    if (this.status.phase === 'checking' || this.status.phase === 'downloading') return this.status;
    this.signal({ kind: 'checking' });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (manual) this.signal({ kind: 'error', message: reason(error) });
    }
    return this.status;
  }

  async download(): Promise<UpdateStatus> {
    if (this.status.phase !== 'available') return this.status;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.signal({ kind: 'error', message: reason(error) });
    }
    return this.status;
  }

  install(): void {
    autoUpdater.quitAndInstall(false, true);
  }

  private signal(signal: UpdateSignal): void {
    this.status = nextUpdateStatus(this.status, signal, Date.now());
    this.publish(this.status);
  }

  private configured(): boolean {
    return updatesConfigured(app.isPackaged, existsSync(join(process.resourcesPath, 'app-update.yml')));
  }
}
