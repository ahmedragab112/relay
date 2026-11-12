import { reloadTransition, type ReloadState } from './state';

/** One in-flight read, one trailing read; disposal prevents queued work. */
export function coalescedReload(load: () => Promise<void>, fail: (error: unknown) => void, delay = 100) {
  let state: ReloadState = { running: false, queued: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  function schedule() {
    if (disposed || state.running || timer || !state.queued) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      state = reloadTransition(state, 'start');
      void load().catch(error => { if (!disposed) fail(error); }).finally(() => {
        state = reloadTransition(state, 'finish');
        schedule();
      });
    }, delay);
  }
  return {
    request() { state = reloadTransition(state, 'request'); schedule(); },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
