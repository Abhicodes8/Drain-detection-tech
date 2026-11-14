import { randomUUID } from 'node:crypto';
import { SETTINGS, MAX_BATCH, monitoringEvents } from './records-domain.js';

// A board keeps posting to the recording ID baked into its secrets.h. A monitoring recording holds at most
// SETTINGS.maxMeasurements readings (about 42 minutes at 500 ms). When it is full, finish it and continue in a fresh
// recording for the same unit, so history spans several recordings and the board never has to be reflashed.
// Returns the ID the readings should be appended to (the posted ID when no rollover is needed).
export async function appendTarget({ store, row, mutate, incoming = 1, clock = Date.now }) {
  if (row.record_type !== 'monitoring') return row.record_id;
  // Roll over before a batch would overflow, and keep forwarding for a recording that rollover already finished.
  const overflow = row.measurements.length + incoming > SETTINGS.maxMeasurements;
  const rolledOver = row.recording_status === 'finished' && row.measurements.length > SETTINGS.maxMeasurements - MAX_BATCH;
  if (!overflow && !rolledOver) return row.record_id;
  if (row.recording_status === 'recording') await mutate(row.record_id, previous => previous.recording_status === 'finished' ? { record: previous } : { record: { ...previous, recording_status: 'finished' } });
  const find = store.headers?.bind(store) ?? store.list.bind(store);
  const filters = { fixture_id: row.fixture_id, data_source: row.data_source, recording_status: 'recording' };
  const active = (await find(filters, 1))[0];
  if (active) return active.record_type === 'monitoring' ? active.record_id : row.record_id;   // never mix into a calibration or drainage
  try {
    return (await store.insert({ record_id: randomUUID(), fixture_id: row.fixture_id, record_type: 'monitoring', data_source: row.data_source,
      recording_status: 'recording', calibration: row.calibration, measurements: [], result: null, created_at: new Date(clock()).toISOString() })).record_id;
  } catch (error) {
    if (error.status === 409) { const again = (await find(filters, 1))[0]; if (again?.record_type === 'monitoring') return again.record_id; }
    throw error;
  }
}

// One small summary per completed drain. Stable IDs let the same drain be saved any number of times safely.
export function completedEventRows(record) {
  if (record.record_type !== 'monitoring' || !record.calibration || record.schema_version === 1) return [];
  return monitoringEvents(record).filter(e => e.recording_status === 'finished' && e.result?.outcome === 'completed' && e.result.drainage_time_seconds > 0)
    .map(e => ({ event_id: e.record_id, fixture_id: record.fixture_id, data_source: record.data_source, record_id: record.record_id, started_at: e.created_at, seconds: e.result.drainage_time_seconds }));
}
export async function saveNewDrainEvents(store, before, after) {
  if (!store.saveDrainEvents || !before || after === before) return;
  const known = new Set(completedEventRows(before).map(r => r.event_id));
  const fresh = completedEventRows(after).filter(r => !known.has(r.event_id));
  if (fresh.length) { try { await store.saveDrainEvents(fresh); } catch { /* history is derived data: never fail an upload over it */ } }
}

export const HISTORY_RANGES = Object.freeze({ '1d': 1, '1w': 7, '1m': 30, '3m': 90, '1y': 365, all: 0 });
export const HISTORY_POINTS = 160;
