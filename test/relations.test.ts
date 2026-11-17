// Relationships between entities (Stage 4, D72): at war, allied, part of, vassal of… holding over
// periods that changes begin and end, with or without events; a second war between the same two is a
// second period of the same relationship; undo, reloading, alternative versions, deleting a party,
// broken references; followed change by change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world-model/world.ts';
import { Engine } from '../src/temporal-engine/engine.ts';
import * as cmd from '../src/domain/commands.ts';
import { gregorian, NEG_INF } from '../src/core-time/index.ts';
import { invertDiffs } from '../src/world-model/schema.ts';
import { relationFrom, RELATION_KINDS } from '../src/domain/relations.ts';

const Y = (y: number, m = 1, d = 1) => gregorian.fromCivil({ year: y, month: m, day: d });

function setup() {
  const world = new World();
  cmd.seedProject(world, 'Relations');
  const engine = new Engine(world);
  const country = (name: string) => cmd.createEntity(world, { type_id: 'polity', name }).result;
  const a = country('Kingdom of Testa'), b = country('Duchy of Proba'), c = country('Aster Republic');
  const hero = cmd.createEntity(world, { type_id: 'character', name: 'Ilse' }).result;
  return { world, engine, a, b, c, hero };
}

test('a war: begins, ends, begins again; the same relationship either way round; read from both sides', () => {
  const s = setup();
  const war = cmd.relate(s.world, { kind: 'war', a: s.a, b: s.b, mode: { kind: 'change', t: Y(1914, 7, 28) }, until: Y(1918, 11, 11) }).result;
  assert.equal(s.engine.relationHolds(war, Y(1914)), false);
  assert.equal(s.engine.relationHolds(war, Y(1916)), true);
  assert.equal(s.engine.relationHolds(war, Y(1919)), false);
  // A second war, given the other way round: the same relationship, a second period.
  const again = cmd.relate(s.world, { kind: 'war', a: s.b, b: s.a, mode: { kind: 'change', t: Y(1939, 9) }, until: Y(1945, 5, 8) }).result;
  assert.equal(again, war, 'mutual: one relationship between the two');
  assert.equal(s.world.all('relation').length, 1);
  assert.deepEqual(s.engine.relationPeriods(war).map((p) => [p.from.day, p.to?.day]), [[Y(1914, 7, 28).day, Y(1918, 11, 11).day], [Y(1939, 9).day, Y(1945, 5, 8).day]]);
  assert.deepEqual(s.engine.relationsAt(Y(1940)), [war]);
  assert.deepEqual(s.engine.relationsAt(Y(1930)), []);
  const r = s.world.get('relation', war)!;
  assert.deepEqual(relationFrom(r, s.a), { words: 'at war with', other: s.b });
  assert.deepEqual(relationFrom(r, s.b), { words: 'at war with', other: s.a });
  // Not mutual: "part of" one way is not the other.
  const part = cmd.relate(s.world, { kind: 'part', a: s.c, b: s.a, mode: { kind: 'correct', t: NEG_INF } }).result;
  assert.notEqual(cmd.relate(s.world, { kind: 'part', a: s.a, b: s.c, mode: { kind: 'correct', t: NEG_INF } }).result, part);
  assert.deepEqual(relationFrom(s.world.get('relation', part)!, s.a), { words: 'has as a part', other: s.c });
  assert.equal(s.engine.relationHolds(part, Y(-5000)), true, 'always: from the beginning of time');
  // Ending and resuming at the date viewed; ending at the same moment again replaces that step.
  cmd.endRelation(s.world, { relation: part, mode: { kind: 'change', t: Y(1800) } });
  cmd.resumeRelation(s.world, { relation: part, mode: { kind: 'change', t: Y(1850) } });
  assert.deepEqual([1799, 1801, 1851].map((y) => s.engine.relationHolds(part, Y(y))), [true, false, true]);
  const steps = s.engine.relationSteps(part).length;
  cmd.endRelation(s.world, { relation: part, mode: { kind: 'change', t: Y(1800) } });
  assert.equal(s.engine.relationSteps(part).length, steps);
  // Checks.
  assert.throws(() => cmd.relate(s.world, { kind: 'war', a: s.a, b: s.a, mode: { kind: 'change', t: Y(1) } }), /two different/);
  assert.throws(() => cmd.relate(s.world, { kind: 'war', a: s.a, b: s.b, mode: { kind: 'change', t: Y(1900) }, until: Y(1899) }), /end after/);
  assert.throws(() => cmd.relate(s.world, { kind: 'nonsense' as never, a: s.a, b: s.b, mode: { kind: 'change', t: Y(1) } }), /what kind/);
  assert.throws(() => cmd.endRelation(s.world, { relation: part, mode: { kind: 'correct', t: NEG_INF } }), /delete it/);
  assert.deepEqual(s.engine.conflicts, []);
  assert.equal(RELATION_KINDS.length, 8);
});

test('relationships in events: begun and ended by them, moved with them, undone, reloaded, switched by alternative versions', () => {
  const s = setup();
  const ev = cmd.createEvent(s.world, { name: 'Treaty of Ardenne', start: Y(1650, 3), end: null }).result;
  const r = cmd.relate(s.world, { kind: 'alliance', a: s.a, b: s.c, mode: { kind: 'new', eventId: ev } });
  const al = r.result;
  assert.equal(s.engine.relationHolds(al, Y(1650, 2)), false);
  assert.equal(s.engine.relationHolds(al, Y(1650, 4)), true);
  cmd.updateEvent(s.world, ev, { start: Y(1660) });
  assert.equal(s.engine.relationHolds(al, Y(1655)), false, 'moved with its event');
  // Ended by a later event.
  const war = cmd.createEvent(s.world, { name: 'Falling out', start: Y(1700) }).result;
  cmd.endRelation(s.world, { relation: al, mode: { kind: 'new', eventId: war } });
  assert.equal(s.engine.relationHolds(al, Y(1701)), false);
  // Undone and redone.
  s.world.applyDiffs(invertDiffs(r.diffs));
  assert.equal(s.world.get('relation', al), undefined);
  s.world.applyDiffs(r.diffs);
  assert.equal(s.engine.relationHolds(al, Y(1690)), true);
  // Reloaded.
  const copy = World.fromSnapshot(JSON.parse(JSON.stringify(s.world.snapshot())));
  const e2 = new Engine(copy);
  assert.equal(e2.relationHolds(al, Y(1690)), true);
  assert.equal(e2.relationHolds(al, Y(1701)), false);
  // An alternative version of the treaty without the alliance.
  const alt = cmd.createVariant(s.world, ev, 'Treaty refused').result;
  for (const f of s.world.all('effect').filter((x) => x.event_id === alt && x.kind === 'relate')) cmd.deleteEffect(s.world, f.id);
  assert.equal(s.engine.relationHolds(al, Y(1690)), false, 'the active version has no alliance');
  cmd.activateVariant(s.world, ev);
  assert.equal(s.engine.relationHolds(al, Y(1690)), true);
  assert.deepEqual(s.engine.conflicts, []);
});

test('deleting: a party takes its relationships with it; a relationship takes its dates; broken references reported', () => {
  const s = setup();
  const war = cmd.relate(s.world, { kind: 'war', a: s.a, b: s.b, mode: { kind: 'change', t: Y(1900) }, until: Y(1910) }).result;
  const leads = cmd.relate(s.world, { kind: 'leads', a: s.hero, b: s.c, mode: { kind: 'correct', t: NEG_INF } }).result;
  cmd.deleteEntity(s.world, s.b);
  assert.equal(s.world.get('relation', war), undefined);
  assert.ok(!s.world.all('effect').some((f) => f.kind === 'relate' && f.intent.includes(war)), 'its changes went too');
  assert.ok(s.world.get('relation', leads));
  cmd.deleteRelations(s.world, [leads]);
  assert.equal(s.world.all('effect').filter((f) => f.kind === 'relate').length, 0);
  // A change left behind by a relationship removed without it (a damaged or old file): reported.
  const again = cmd.relate(s.world, { kind: 'vassal', a: s.c, b: s.a, mode: { kind: 'change', t: Y(1500) } }).result;
  s.world.applyDiffs([{ table: 'relation', before: s.world.get('relation', again)!, after: null }]);
  assert.equal(s.engine.conflicts.length, 1);
  assert.match(s.engine.conflicts[0].message, /relationship that no longer exists/);
});

test('the engine follows relationship edits one by one and agrees with a fresh compile (random edits, undo)', () => {
  const s = setup();
  Engine.verify = true;
  Engine.verifyFailures = [];
  try {
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ents = [s.a, s.b, s.c, s.hero];
    const kinds = ['war', 'alliance', 'part', 'vassal', 'member', 'leads', 'successor', 'travels'] as const;
    const ev = cmd.createEvent(s.world, { name: 'Congress', start: Y(1815) }).result;
    const done: Array<{ diffs: ReturnType<typeof cmd.relate>['diffs'] }> = [];
    for (let i = 0; i < 150; i++) {
      const rels = s.world.all('relation');
      const t = Y(1700 + Math.floor(rnd() * 250));
      const x = rnd();
      let res: { diffs: ReturnType<typeof cmd.relate>['diffs'] } | null = null;
      try {
        if (x < 0.35 || !rels.length) {
          const a = ents[Math.floor(rnd() * 4)], b = ents[(ents.indexOf(a) + 1 + Math.floor(rnd() * 3)) % 4];
          res = cmd.relate(s.world, { kind: kinds[Math.floor(rnd() * kinds.length)], a, b, mode: rnd() < 0.3 ? { kind: 'new', eventId: ev } : { kind: 'change', t }, until: rnd() < 0.3 ? Y(1950 + Math.floor(rnd() * 50)) : null });
        } else {
          const r = rels[Math.floor(rnd() * rels.length)];
          if (x < 0.6) res = cmd.endRelation(s.world, { relation: r.id, mode: { kind: 'change', t } });
          else if (x < 0.75) res = cmd.resumeRelation(s.world, { relation: r.id, mode: { kind: 'change', t } });
          else if (x < 0.82) res = cmd.deleteRelations(s.world, [r.id]);
          else if (x < 0.88) res = cmd.updateRelation(s.world, r.id, { notes: `note ${i}` });
          else if (done.length) s.world.applyDiffs(invertDiffs(done.pop()!.diffs));
        }
      } catch (e) {
        if (!/end after/.test(String(e))) throw e;
      }
      if (res) done.push(res);
      s.engine.relationsAt(t);
    }
    assert.deepEqual(Engine.verifyFailures, []);
    assert.ok(s.engine.stats.followed > 60, `followed change by change ${s.engine.stats.followed} times`);
  } finally {
    Engine.verify = false;
  }
});
