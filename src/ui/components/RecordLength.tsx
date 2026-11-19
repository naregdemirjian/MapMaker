// How long changes take (fifth feedback round, D86). While recording into an event: what each change
// recorded does (at once, spreads until the next one recorded, until the event ends, or over a set
// time) and how it spreads; kept on this computer. In the event's panel: how long each of its changes
// takes (until the event ends, until a date, or for a time from its own date).
import { useEffect, useState } from 'react';
import { useStore } from '../store.ts';
import { saveRecordLength, type RecordLength, type RecordWhen, type LengthUnit } from '../record-length.ts';
import * as cmd from '../../domain/commands.ts';
import { parseJSON, effectTime, eventEnd, transitionEnd, type TransitionSpec } from '../../temporal-engine/engine.ts';
import { compare, stepDate, type Instant } from '../../core-time/index.ts';
import type { EffectRow, EventRow } from '../../world-model/schema.ts';
import { DateField, fmt } from './Panels.tsx';

const UNITS: Array<[LengthUnit, string]> = [['day', 'days'], ['month', 'months'], ['year', 'years']];

/** A whole number field saved when left or on Enter. */
function CountField({ value, onCommit, testId }: { value: number; onCommit: (n: number) => void; testId: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => { const n = Math.round(Number(text)); if (n >= 1 && n !== value) onCommit(n); else setText(String(value)); };
  return <input className="count" type="number" min={1} step={1} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} data-testid={testId} />;
}

/** In the recording bar: what each change recorded does. */
export function RecordLengthControls() {
  const s = useStore();
  const r = s.recordLength;
  const rec = s.recordEventId ? s.world?.get('event', s.recordEventId) : null;
  const set = (patch: Partial<RecordLength>) => { const next = { ...r, ...patch }; saveRecordLength(next); s.set({ recordLength: next }); };
  const noEnd = !!rec && rec.end_day === null;
  return (
    <span className="record-length" data-testid="record-length">
      <label className="inline">Each change
        <select value={r.when} onChange={(e) => set({ when: e.target.value as RecordWhen })} data-testid="record-when"
          title="How long each change you record takes: at once, or spreading until the next change you record, until the event ends, or over a set time">
          <option value="instant">happens at once</option>
          <option value="next">spreads until the next one I record</option>
          <option value="event">spreads until the event ends</option>
          <option value="for">spreads over…</option>
        </select>
      </label>
      {r.when === 'for' && <>
        <CountField value={r.n} onCommit={(n) => set({ n })} testId="record-for-n" />
        <select value={r.unit} onChange={(e) => set({ unit: e.target.value as LengthUnit })} data-testid="record-for-unit">
          {UNITS.map(([u, name]) => <option key={u} value={u}>{name}</option>)}
        </select>
      </>}
      {r.when !== 'instant' && (
        <label className="inline">as
          <select value={r.style} onChange={(e) => set({ style: e.target.value as RecordLength['style'] })} data-testid="record-style">
            <option value="border" title="Through the land from the country's border, as a front advancing">an advancing front</option>
            <option value="advance" title="Spreading through the land from where you start drawing">an expansion</option>
            <option value="dissolve" title="No front: the land changes hands in patches">a dissolve</option>
            <option value="fade">a fade</option>
          </select>
        </label>
      )}
      {noEnd && (r.when === 'event' || r.when === 'next') && <span className="muted-red" title="Give the event an end date in its panel">{r.when === 'event' ? 'The event has no end: changes happen at once.' : 'The event has no end: the last change happens at once.'}</span>}
    </span>
  );
}

/** In the event's panel: how long one of its changes takes. Nothing for a change that happens at once. */
export function ChangeLength({ f, ev }: { f: EffectRow; ev: EventRow }) {
  const s = useStore();
  const spec = parseJSON<TransitionSpec | null>(f.transition, null);
  if (!spec || spec.style === 'instant') return null;
  const start = effectTime(f, ev);
  const evEnd = eventEnd(ev);
  const end = transitionEnd(spec, start, ev);
  const kind = spec.until ? 'until' : spec.for ? 'for' : 'event';
  const save = (length: Parameters<typeof cmd.setEffectLength>[2]) => s.execute((wd) => cmd.setEffectLength(wd, f.id, length));
  const choose = (k: string) => {
    if (k === kind) return;
    if (k === 'event') save(null);
    else if (k === 'for') save({ for: { n: 1, unit: 'year' } });
    else save({ until: end && compare(end, start) > 0 ? end : stepDate(start, 'year', 1) });
  };
  return (
    <span className="change-length">
      <label className="inline">Takes
        <select value={kind} onChange={(e) => choose(e.target.value)} data-testid="change-length">
          <option value="event">until the event ends{evEnd ? '' : ' (it has none: at once)'}</option>
          <option value="until">until a date</option>
          <option value="for">for a time</option>
        </select>
      </label>
      {kind === 'until' && <DateField value={end} onChange={(t: Instant | null) => t && save({ until: t })} testId="change-until" />}
      {kind === 'for' && spec.for && <>
        <CountField value={spec.for.n} onCommit={(n) => save({ for: { n, unit: spec.for!.unit } })} testId="change-for-n" />
        <select value={spec.for.unit} onChange={(e) => save({ for: { n: spec.for!.n, unit: e.target.value as LengthUnit } })} data-testid="change-for-unit">
          {UNITS.map(([u, name]) => <option key={u} value={u}>{name}</option>)}
        </select>
      </>}
      <span className="muted" data-testid="change-span">{end && compare(end, start) > 0 ? `${fmt(start)} to ${fmt(end)}` : `at once on ${fmt(start)}`}{spec.next ? ' (until the next change recorded)' : ''}</span>
    </span>
  );
}
