import { useMemo, useState } from 'react';
import { addDays, formatMD, formatShort } from '../../domain/dates';
import { PLACEMENT_AREAS, activeNotes, barLabel, effectiveSchedule, eventsOn, noteWhenText, placement, sitesOn, vehicleBars } from '../../domain/derive';
import type { Member, Note, NoteCategory, Schedule } from '../../domain/types';
import { useBoard } from '../app/AppContext';
import { useToday } from '../board/BoardPage';
import { NoteDialog } from '../board/NoteDialog';
import { Dialog } from '../common/Dialog';
import { StatusBar } from '../common/StatusBar';
import type { Route } from '../router';
import { ScheduleDialog } from '../schedule/ScheduleDialog';

/** スマホ画面：「今日」を縦1列で見る。編集は入力フォームで行う */
export function MobilePage({ navigate }: { navigate: (p: Route) => void }) {
  const { data } = useBoard();
  const todayStr = useToday();
  const [offset, setOffset] = useState(0);
  const date = addDays(todayStr, offset);
  const [schedule, setSchedule] = useState<Partial<Schedule> | null>(null);
  const [note, setNote] = useState<{ category: NoteCategory; note: Note | null } | null>(null);
  const [person, setPerson] = useState<Member | null>(null);

  const p = placement(data, date);
  const sites = sitesOn(data, date);
  const vehicles = useMemo(() => data.vehicles.filter((v) => v.active).sort((a, b) => a.order - b.order), [data.vehicles]);
  const events = eventsOn(data, date);

  const notes = (category: NoteCategory, title = category as string) => {
    const list = activeNotes(data, category, date);
    return (
      <section className="m-card">
        <h2>
          {title}
          <button type="button" className="btn-add" onClick={() => setNote({ category, note: null })} aria-label={`${title}を追加`}>
            ＋
          </button>
        </h2>
        {list.length === 0 && <p className="empty">ありません</p>}
        {list.map((n) => (
          <button key={n.id} type="button" className="m-line" onClick={() => setNote({ category, note: n })}>
            {noteWhenText(n) && <span className="note-date">{noteWhenText(n)}</span>}
            <span>{n.text}</span>
            {category === 'トラブル' && <span className="trouble-dot" />}
          </button>
        ))}
      </section>
    );
  };

  const tag = (m: Member) => (
    <button key={m.id} type="button" className="tag" onClick={() => setPerson(m)}>
      {m.name}
    </button>
  );

  return (
    <div className="page mobile-page">
      <header className="m-head">
        <button type="button" className="btn" onClick={() => setOffset((n) => n - 1)} aria-label="前の日">
          ◀
        </button>
        <button type="button" className="m-date" onClick={() => setOffset(0)}>
          {formatMD(date)}
          {offset === 0 ? <span className="badge badge-info">今日</span> : <span className="badge badge-warn">今日へ戻る</span>}
        </button>
        <button type="button" className="btn" onClick={() => setOffset((n) => n + 1)} aria-label="次の日">
          ▶
        </button>
      </header>
      <StatusBar />

      <section className="m-card">
        <h2>人の配置</h2>
        {PLACEMENT_AREAS.map((area) => (
          <div key={area} className="m-area">
            <span className="m-area-label">{area}</span>
            <div className="tags">{p[area].length === 0 ? <span className="empty">—</span> : p[area].map(tag)}</div>
          </div>
        ))}
      </section>

      <section className="m-card">
        <h2>車両</h2>
        {vehicles.map((v) => {
          const bars = vehicleBars(data, v.id, date, date);
          return (
            <div key={v.id} className="m-area">
              <span className="car-tag">{v.name}</span>
              <div className="m-car-use">
                {bars.length === 0 && <span className="m-free">空き</span>}
                {bars.map((b) => (
                  <button key={b.key} type="button" className={`m-use${b.conflict ? ' bar-conflict' : ''}`} onClick={() => setSchedule({ id: b.scheduleIds[0] })}>
                    {barLabel(b)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {vehicles.length === 0 && <p className="empty">車両がありません</p>}
      </section>

      <section className="m-card">
        <h2>現場</h2>
        {sites.length === 0 && <p className="empty">現場に出ている人はいません</p>}
        {sites.map((s) => (
          <div key={s.site} className="m-area">
            <span className="m-site">{s.site}</span>
            <div className="tags">{s.members.map(tag)}</div>
          </div>
        ))}
      </section>

      {notes('トラブル')}
      {notes('連絡事項')}
      {notes('来客予定')}

      <section className="m-card">
        <h2>
          イベント
          <button type="button" className="btn-add" onClick={() => setNote({ category: 'イベント', note: null })} aria-label="イベントを追加">
            ＋
          </button>
        </h2>
        {events.length === 0 && <p className="empty">ありません</p>}
        {events.map((e) => (
          <button
            key={e.key}
            type="button"
            className="m-line"
            onClick={() => (e.source === 'vehicle' ? setSchedule({ id: e.refId }) : setNote({ category: 'イベント', note: data.notes.find((n) => n.id === e.refId) ?? null }))}
          >
            {noteWhenText(e) && <span className="note-date">{noteWhenText(e)}</span>}
            <span>{e.text}</span>
          </button>
        ))}
      </section>

      <footer className="m-foot">
        <button type="button" className="btn btn-primary" onClick={() => setSchedule({ memberIds: [], start: date, end: date, kind: '現場' })}>
          ＋ 予定を追加
        </button>
        <button type="button" className="btn" onClick={() => navigate('/admin')}>
          管理
        </button>
      </footer>

      {person && (
        <PersonDialog
          member={person}
          date={date}
          onClose={() => setPerson(null)}
          onOpen={(s) => {
            setPerson(null);
            setSchedule(s);
          }}
        />
      )}
      {schedule && <ScheduleDialog initial={schedule} onClose={() => setSchedule(null)} />}
      {note && <NoteDialog category={note.category} note={note.note} onClose={() => setNote(null)} />}
    </div>
  );
}

/** 1人分：その日の予定と、今後の予定の一覧 */
function PersonDialog({ member, date, onClose, onOpen }: { member: Member; date: string; onClose: () => void; onOpen: (s: Partial<Schedule>) => void }) {
  const { data } = useBoard();
  const eff = effectiveSchedule(data, member.id, date);
  const upcoming = data.schedules
    .filter((s) => s.memberIds.includes(member.id) && s.end >= date && s.start <= s.end)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return (
    <Dialog
      title={`${member.name} の予定`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={() => onOpen({ memberIds: [member.id], start: date, end: date, kind: '現場' })}>
            ＋ この人の予定を追加
          </button>
        </>
      }
    >
      <p className="hint">
        {formatMD(date)}：{eff ? `${eff.kind}${eff.site ? `（${eff.site}）` : ''}` : `予定なし（普段の居場所：${member.base}）`}
      </p>
      {upcoming.length === 0 && <p className="empty">今後の予定はありません</p>}
      {upcoming.map((s) => (
        <button key={s.id} type="button" className="m-line" onClick={() => onOpen({ id: s.id })}>
          <span className="note-date">
            {formatShort(s.start)}
            {s.end !== s.start ? `〜${formatShort(s.end)}` : ''}
          </span>
          <span>
            {s.kind}
            {s.site ? `（${s.site}）` : ''}
          </span>
        </button>
      ))}
    </Dialog>
  );
}
