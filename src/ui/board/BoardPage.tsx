import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, formatMD, today } from '../../domain/dates';
import { effectiveSchedule, type Area } from '../../domain/derive';
import type { DateStr, Member, Note, NoteCategory, Schedule } from '../../domain/types';
import { useBoard } from '../app/AppContext';
import { StatusBar } from '../common/StatusBar';
import type { Route } from '../router';
import { ScheduleDialog } from '../schedule/ScheduleDialog';
import { NoteDialog } from './NoteDialog';
import { VehicleCalendar } from './VehicleCalendar';
import { dropMember } from './dropActions';
import { EventPanel, NotesPanel, PlacementPanel, QrCorner, SitePanel } from './panels';

const RETURN_TO_TODAY_MS = 5 * 60 * 1000;

/** 今日の日付（1分ごとに確認し、日付が変わったら切り替える） */
export function useToday(): DateStr {
  const [t, setT] = useState(() => today());
  useEffect(() => {
    const id = setInterval(() => setT(today()), 60000);
    return () => clearInterval(id);
  }, []);
  return t;
}

/** ボード画面：現行ホワイトボードと同じ配置 */
export function BoardPage({ navigate }: { navigate: (p: Route) => void }) {
  const { data, dispatch, device } = useBoard();
  const todayStr = useToday();
  const [viewDate, setViewDate] = useState<DateStr | null>(null); // null = 今日
  const date = viewDate ?? todayStr;
  const [schedule, setSchedule] = useState<Partial<Schedule> | null>(null);
  const [note, setNote] = useState<{ category: NoteCategory; note: Note | null } | null>(null);
  const [dragging, setDragging] = useState<Member | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // 今日以外を表示中、5分間操作が無ければ今日へ戻す
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setViewDate(null), RETURN_TO_TODAY_MS);
  }, []);
  useEffect(() => {
    if (viewDate === null) return;
    touch();
    window.addEventListener('pointerdown', touch);
    return () => {
      window.removeEventListener('pointerdown', touch);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [viewDate, touch]);

  const shift = (n: number) => {
    const next = addDays(date, n);
    setViewDate(next === todayStr ? null : next);
  };

  const onDragStart = (e: DragStartEvent) => setDragging(data.members.find((m) => m.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (!e.over) return;
    const result = dropMember(data, String(e.active.id), e.over.id as Area, date, device);
    if ('ops' in result) dispatch(...result.ops);
    else if ('openDialog' in result) setSchedule(result.openDialog);
  };

  const tapMember = (m: Member) => {
    const eff = effectiveSchedule(data, m.id, date);
    setSchedule(eff ?? { memberIds: [m.id], start: date, end: date, kind: '休み' });
  };

  return (
    <div className="board-page">
      <header className="board-bar">
        <span className="app-name">行動予定ボード</span>
        <StatusBar />
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => navigate('/input')}>
          予定入力
        </button>
        <button type="button" className="btn" onClick={() => navigate('/admin')}>
          人員・車両の管理
        </button>
      </header>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <main className="board">
          <section className="panel cell-placement">
            <div className="date-head">
              <button type="button" className="btn-nav" onClick={() => shift(-1)} aria-label="前の日">
                ◀
              </button>
              <span className={`date-big${viewDate ? ' date-other' : ''}`}>{formatMD(date)}</span>
              <button type="button" className="btn-nav" onClick={() => shift(1)} aria-label="次の日">
                ▶
              </button>
              {viewDate && (
                <button type="button" className="btn-nav btn-today" onClick={() => setViewDate(null)}>
                  今日へ
                </button>
              )}
            </div>
            <PlacementPanel date={date} onTapMember={tapMember} />
          </section>

          <section className="cell-vehicle">
            <VehicleCalendar todayStr={todayStr} onEdit={setSchedule} />
          </section>

          <section className="cell-event">
            <EventPanel
              date={date}
              todayStr={todayStr}
              onEditNote={(n) => setNote({ category: 'イベント', note: n })}
              onEditVehicle={(id) => setSchedule({ id })}
            />
          </section>

          <section className="cell-site">
            <SitePanel date={date} onTapMember={tapMember} />
          </section>
          <section className="cell-trouble">
            <NotesPanel category="トラブル" date={date} onEdit={(n) => setNote({ category: 'トラブル', note: n })} />
          </section>
          <section className="cell-notice">
            <NotesPanel category="連絡事項" date={date} onEdit={(n) => setNote({ category: '連絡事項', note: n })} />
          </section>
          <section className="cell-visitor">
            <NotesPanel category="来客予定" date={date} onEdit={(n) => setNote({ category: '来客予定', note: n })}>
              <QrCorner />
            </NotesPanel>
          </section>
        </main>
        <DragOverlay dropAnimation={null}>{dragging ? <span className="tag tag-overlay">{dragging.name}</span> : null}</DragOverlay>
      </DndContext>

      {schedule && <ScheduleDialog initial={schedule} onClose={() => setSchedule(null)} />}
      {note && <NoteDialog category={note.category} note={note.note} onClose={() => setNote(null)} />}
    </div>
  );
}
