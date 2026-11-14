'use client';
import { useEffect, useMemo, useState } from 'react';
import { DrainApi } from '../../lib/api';
import type { DataSource, HistoryPoint, HistoryRange } from '../../lib/api';
import { useSession } from '../../lib/supabase';

// Per-drain history for one unit. A few KB however long the range; refreshed once a minute while the tab is visible.
// Returns null points when the backend has no history (for example the local demo backend), so callers can fall back.
export function useDrainHistory(fixture: string, source: DataSource, range: HistoryRange) {
  const session = useSession();
  const api = useMemo(() => new DrainApi('/api/backend', session?.access_token || ''), [session?.access_token]);
  const [state, setState] = useState<{ key: string; points: HistoryPoint[] | null }>({ key: '', points: null });
  const key = `${fixture}|${source}|${range}`;
  useEffect(() => {
    if (!fixture) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (document.hidden) { timer = setTimeout(load, 1000); return; }
      try {
        const result = await api.history(fixture, source, range, controller.signal);
        if (!controller.signal.aborted) setState({ key, points: result.points });
      } catch { if (!controller.signal.aborted) setState({ key, points: null }); }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 60000); }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [api, fixture, source, range, key]);
  return state.key === key ? state.points : null;
}
