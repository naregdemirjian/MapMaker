// Relationships of a country, faction, character or city (Stage 4, D72): who it is at war or allied
// with, part of, vassal of, member of, leads, succeeds, travels with; the periods each holds, and
// adding, ending, resuming and deleting them.
import { useState } from 'react';
import { useStore } from '../store.ts';
import * as cmd from '../../domain/commands.ts';
import { type Instant, compare, fromStore, NEG_INF } from '../../core-time/index.ts';
import { eventsHere } from '../events-here.ts';
import { RELATION_KINDS, relationFrom, type RelationKind } from '../../domain/relations.ts';
import { DateField, fmt } from './Panels.tsx';

/** The ways a relationship can be chosen from this entity's side: the kind, and whether this entity is the second party. */
const CHOICES: Array<{ key: string; kind: RelationKind; reverse: boolean; label: string }> = RELATION_KINDS.flatMap((k) => (k.mutual
  ? [{ key: k.id, kind: k.id, reverse: false, label: k.fromA }]
  : [{ key: k.id, kind: k.id, reverse: false, label: k.fromA }, { key: `${k.id}~`, kind: k.id, reverse: true, label: k.fromB }]));

export function RelationsSection({ id }: { id: string }) {
  const s = useStore();
  const w = s.world!, e = s.engine!;
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState(CHOICES[0].key);
  const [other, setOther] = useState('');
  const [when, setWhen] = useState<'change' | 'always' | 'event'>('change');
  const [eventId, setEventId] = useState('');
  const [until, setUntil] = useState<Instant | null>(null);
  const rels = w.all('relation').filter((r) => r.a === id || r.b === id).sort((a, b) => a.created_seq - b.created_seq);
  const others = w.all('entity').filter((x) => x.id !== id && x.type_id !== 'body').sort((a, b) => a.name.localeCompare(b.name));
  const events = eventsHere();
  const add = () => {
    const c = CHOICES.find((x) => x.key === choice)!;
    if (!other) { s.toast('Choose who it is with.', 'error'); return; }
    let mode: cmd.EditMode;
    if (when === 'always') mode = { kind: 'correct', t: NEG_INF };
    else if (when === 'event') {
      const ev = w.get('event', eventId);
      if (!ev) { s.toast('Choose the event.', 'error'); return; }
      const start = fromStore(ev.start_day, ev.start_ms);
      mode = { kind: 'new', eventId, at: compare(s.time, start) > 0 ? s.time : null };
    } else mode = { kind: 'change', t: s.time };
    const [a, b] = c.reverse ? [other, id] : [id, other];
    const r = s.execute((wd) => cmd.relate(wd, { kind: c.kind, a, b, mode, until }));
    if (r) { setAdding(false); setOther(''); setUntil(null); }
  };
  return (
    <div className="relations-section" data-testid="relations">
      <h4>Relationships</h4>
      {rels.map((r) => {
        const { words, other: o } = relationFrom(r, id);
        const periods = e.relationPeriods(r.id);
        const now = e.relationHolds(r.id, s.time);
        const name = w.get('entity', o)?.name ?? '(deleted)';
        return (
          <div key={r.id} className={`relation ${now ? 'on' : ''}`} data-testid="relation-row">
            <div className="relation-head">
              <span className="relation-words">{words[0].toUpperCase() + words.slice(1)}</span>{' '}
              <button className="link" onClick={() => s.set({ selection: { kind: 'entity', id: o } })}>{name}</button>
              {now && <span className="badge" title={`On ${fmt(s.time)}`}>now</span>}
            </div>
            <div className="muted small-note" data-testid="relation-periods">
              {periods.length ? periods.map((p, i) => (
                <span key={i}>{i ? '; ' : ''}
                  <button className="link" onClick={() => p.from.day !== -Infinity && s.setTime(p.from)}>{p.from.day === -Infinity ? 'always' : fmt(p.from)}</button>
                  {' – '}{p.to ? <button className="link" onClick={() => s.setTime(p.to!)}>{fmt(p.to)}</button> : '…'}
                </span>
              )) : 'never (its changes were removed)'}
            </div>
            <div className="effect-tools">
              {now
                ? <button className="small" onClick={() => s.execute((wd) => cmd.endRelation(wd, { relation: r.id, mode: { kind: 'change', t: s.time } }))} data-testid="relation-end">Ends on {fmt(s.time)}</button>
                : <button className="small" onClick={() => s.execute((wd) => cmd.resumeRelation(wd, { relation: r.id, mode: { kind: 'change', t: s.time } }))} data-testid="relation-resume">Again from {fmt(s.time)}</button>}
              <button className="small danger" onClick={() => { if (confirm('Delete this relationship and all its dates?')) s.execute((wd) => cmd.deleteRelations(wd, [r.id])); }}>Delete</button>
            </div>
          </div>
        );
      })}
      {!rels.length && !adding && <div className="muted">None yet.</div>}
      {adding ? (
        <div className="relation-form" data-testid="relation-form">
          <label>Relationship
            <select value={choice} onChange={(ev) => setChoice(ev.target.value)} data-testid="relation-kind">
              {CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <div className="muted small-note">{RELATION_KINDS.find((k) => k.id === CHOICES.find((c) => c.key === choice)?.kind)?.hint}</div>
          <label>With
            <select value={other} onChange={(ev) => setOther(ev.target.value)} data-testid="relation-other">
              <option value="">Choose…</option>
              {others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label>When
            <select value={when} onChange={(ev) => setWhen(ev.target.value as typeof when)} data-testid="relation-when">
              <option value="change">From {fmt(s.time)}</option>
              <option value="always">Always</option>
              <option value="event">With an event…</option>
            </select>
          </label>
          {when === 'event' && (
            <label>Event
              <select value={eventId} onChange={(ev) => setEventId(ev.target.value)} data-testid="relation-event">
                <option value="">Choose…</option>
                {events.map((x) => <option key={x.id} value={x.id}>{fmt(fromStore(x.start_day, x.start_ms))} · {x.name}</option>)}
              </select>
            </label>
          )}
          <label>Until (optional)<DateField value={until} allowEmpty placeholder="(still holds)" onChange={setUntil} testId="relation-until" /></label>
          <div className="buttons"><button onClick={() => setAdding(false)}>Cancel</button><button className="primary" onClick={add} data-testid="relation-add">Add</button></div>
        </div>
      ) : <button className="small" onClick={() => setAdding(true)} data-testid="relation-new">+ Relationship</button>}
    </div>
  );
}
