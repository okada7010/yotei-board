import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, addMonths, dayKind, daysInMonth, firstOfMonth, formatMD, mondayOf, parseDate, rangeDays, weekdayLabel } from '../../domain/dates';
import { sortedMembers } from '../../domain/derive';
import { ARCHIVE_AFTER_DAYS } from '../../domain/ops';
import { BASES, type Base, type DateStr, type Schedule } from '../../domain/types';
import { addMember } from '../admin/adminActions';
import { useBoard } from '../app/AppContext';
import { useToday } from '../board/BoardPage';
import { Dialog } from '../common/Dialog';
import { StatusBar } from '../common/StatusBar';
import type { Route } from '../router';
import { ScheduleDialog } from '../schedule/ScheduleDialog';
import { memberRow, type Cell } from './gridModel';

type Mode = 'week' | 'month';

interface Selecting {
  memberId: string;
  from: number;
  to: number;
}

function cellLabel(s: Schedule, vehicleName: (id: string | null) => string | null): string {
  if (s.kind !== '現場') return s.kind;
  const car = vehicleName(s.vehicleId);
  return car ? `${s.site}／${car}` : s.site;
}

/** 予定入力画面：グループ別の人員リスト × 日付 */
export function InputPage({ navigate }: { navigate: (p: Route) => void }) {
  const { data, dispatch, device, store } = useBoard();
  const todayStr = useToday();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState<DateStr>(todayStr);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ initial: Partial<Schedule>; readOnly?: boolean } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<Selecting | null>(null);
  const selectingRef = useRef<Selecting | null>(null);
  const [archive, setArchive] = useState<Schedule[]>([]);
  const loadedYears = useRef(new Set<string>());

  const days = useMemo(() => (mode === 'week' ? rangeDays(mondayOf(anchor), 7) : rangeDays(firstOfMonth(anchor), daysInMonth(anchor))), [mode, anchor]);
  const members = useMemo(() => sortedMembers(data), [data]);
  const groups = useMemo(() => [...data.groups].sort((a, b) => a.order - b.order), [data.groups]);
  const vehicleName = useMemo(() => {
    const map = new Map(data.vehicles.map((v) => [v.id, v.name]));
    return (id: string | null) => (id ? (map.get(id) ?? null) : null);
  }, [data.vehicles]);

  // 60日より前を表示したら、その年の「過去の記録」を読み込む
  useEffect(() => {
    if (days[0] >= addDays(todayStr, -ARCHIVE_AFTER_DAYS)) return;
    const years = new Set([days[0].slice(0, 4), days[days.length - 1].slice(0, 4)]);
    for (const year of years) {
      if (loadedYears.current.has(year)) continue;
      loadedYears.current.add(year);
      store
        .loadArchive(year)
        .then((list) => setArchive((cur) => [...cur, ...list]))
        .catch(() => loadedYears.current.delete(year));
    }
  }, [days, todayStr, store]);

  const shift = (n: number) => setAnchor((a) => (mode === 'week' ? addDays(a, n * 7) : addMonths(a, n)));
  const title = mode === 'week' ? `${formatMD(days[0])} 〜 ${formatMD(days[6])}` : `${parseDate(days[0]).getFullYear()}年${parseDate(days[0]).getMonth() + 1}月`;

  const indexAt = (e: ReactPointerEvent<HTMLElement>, row: HTMLElement): number => {
    const rect = row.getBoundingClientRect();
    return Math.min(days.length - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * days.length)));
  };

  const onRowDown = (e: ReactPointerEvent<HTMLDivElement>, memberId: string) => {
    if ((e.target as HTMLElement).closest('.gcell-filled')) return; // 既存の予定はタップで編集
    e.currentTarget.setPointerCapture(e.pointerId);
    const i = indexAt(e, e.currentTarget);
    selectingRef.current = { memberId, from: i, to: i };
    setSelecting(selectingRef.current);
  };
  const onRowMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const cur = selectingRef.current;
    if (!cur) return;
    const i = indexAt(e, e.currentTarget);
    if (i === cur.to) return;
    selectingRef.current = { ...cur, to: i };
    setSelecting(selectingRef.current);
  };
  const onRowUp = () => {
    const cur = selectingRef.current;
    selectingRef.current = null;
    setSelecting(null);
    if (!cur) return;
    const a = Math.min(cur.from, cur.to);
    const b = Math.max(cur.from, cur.to);
    setDialog({ initial: { memberIds: [cur.memberId], start: days[a], end: days[b], kind: '現場' } });
  };

  const openCell = (c: Cell) => {
    if (!c.schedule) return;
    setDialog({ initial: c.schedule.id && !c.archived ? { id: c.schedule.id } : c.schedule, readOnly: c.archived });
  };

  const colTemplate = { gridTemplateColumns: `repeat(${days.length}, minmax(${mode === 'week' ? '0' : '2.6rem'}, 1fr))` };

  return (
    <div className="page input-page">
      <header className="page-bar">
        <button type="button" className="btn" onClick={() => navigate('/board')}>
          ← ボード
        </button>
        <h1>予定入力</h1>
        <StatusBar />
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => navigate('/admin')}>
          人員・車両の管理
        </button>
      </header>

      <div className="input-tools">
        <button type="button" className="btn" onClick={() => shift(-1)} aria-label="前へ">
          ◀
        </button>
        <span className="input-title">{title}</span>
        <button type="button" className="btn" onClick={() => shift(1)} aria-label="次へ">
          ▶
        </button>
        <button type="button" className="btn" onClick={() => setAnchor(todayStr)}>
          今日
        </button>
        <span className="spacer" />
        <div className="seg">
          <button type="button" className={`seg-item${mode === 'week' ? ' seg-on' : ''}`} onClick={() => setMode('week')}>
            週
          </button>
          <button type="button" className={`seg-item${mode === 'month' ? ' seg-on' : ''}`} onClick={() => setMode('month')}>
            月
          </button>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setDialog({ initial: { memberIds: [], start: todayStr, end: todayStr, kind: '現場' } })}>
          ＋ 予定を追加
        </button>
      </div>

      <div className="grid-scroll">
        <div className={`igrid igrid-${mode}`}>
          <div className="irow irow-head">
            <div className="iname">人員</div>
            <div className="idays" style={colTemplate}>
              {days.map((d) => (
                <div key={d} className={`ihead ${dayKind(d)}${d === todayStr ? ' is-today' : ''}`}>
                  <span>{parseDate(d).getDate()}</span>
                  <span className="ihead-wd">{weekdayLabel(d)}</span>
                </div>
              ))}
            </div>
          </div>

          {groups.map((g) => {
            const list = members.filter((m) => m.groupId === g.id);
            const closed = collapsed.has(g.id);
            return (
              <div key={g.id} className="igroup">
                <button
                  type="button"
                  className="igroup-head"
                  aria-expanded={!closed}
                  onClick={() => setCollapsed((cur) => { const next = new Set(cur); if (next.has(g.id)) next.delete(g.id); else next.add(g.id); return next; })}
                >
                  <span>{closed ? '▶' : '▼'}</span> {g.name}
                  <span className="igroup-count">{list.length}名</span>
                </button>
                {!closed &&
                  list.map((m) => {
                    const cells = memberRow(data, m.id, days, archive);
                    const sel = selecting && selecting.memberId === m.id ? selecting : null;
                    let col = 1;
                    return (
                      <div key={m.id} className="irow">
                        <div className="iname">
                          {m.name}
                          <span className="iname-base">{m.base}</span>
                        </div>
                        <div className="idays icells" style={colTemplate} onPointerDown={(e) => onRowDown(e, m.id)} onPointerMove={onRowMove} onPointerUp={onRowUp} onPointerCancel={() => { selectingRef.current = null; setSelecting(null); }}>
                          {days.map((d, i) => (
                            <span key={d} className={`gcol ${dayKind(d)}${d === todayStr ? ' is-today' : ''}${sel && i >= Math.min(sel.from, sel.to) && i <= Math.max(sel.from, sel.to) ? ' is-selecting' : ''}`} style={{ gridColumn: i + 1, gridRow: 1 }} />
                          ))}
                          {cells.map((c) => {
                            const start = col;
                            col += c.span;
                            if (!c.schedule) return null;
                            return (
                              <button
                                key={`${c.schedule.id}:${c.date}`}
                                type="button"
                                className={`gcell-filled kind-${c.schedule.kind}${c.archived ? ' is-archived' : ''}`}
                                style={{ gridColumn: `${start} / span ${c.span}`, gridRow: 1 }}
                                onClick={() => openCell(c)}
                                title={c.schedule.memo || undefined}
                              >
                                {!c.isStart && '◂ '}
                                {cellLabel(c.schedule, vehicleName)}
                                {c.overlapped > 0 && <span className="overlap-mark">＋{c.overlapped}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                {!closed && (
                  <button type="button" className="igroup-add" onClick={() => setAdding(g.id)}>
                    ＋ 人員を追加
                  </button>
                )}
              </div>
            );
          })}
          {groups.length === 0 && <p className="empty">「人員・車両の管理」からグループを追加してください</p>}
        </div>
      </div>
      <p className="hint input-hint">空いているマスをなぞると、その期間の予定を入力できます。空欄の日は普段の居場所（土日祝は休み）として表示されます。</p>

      {dialog && <ScheduleDialog initial={dialog.initial} readOnly={dialog.readOnly} onClose={() => setDialog(null)} />}
      {adding && (
        <AddMemberDialog
          groupName={groups.find((g) => g.id === adding)?.name ?? ''}
          onClose={() => setAdding(null)}
          onAdd={(name, base) => {
            dispatch(...addMember(data, name, adding, base, device));
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

function AddMemberDialog({ groupName, onClose, onAdd }: { groupName: string; onClose: () => void; onAdd: (name: string, base: Base) => void }) {
  const [name, setName] = useState('');
  const [base, setBase] = useState<Base>('LABO');
  return (
    <Dialog
      title={`${groupName} に人員を追加`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => onAdd(name, base)}>
            追加
          </button>
        </>
      }
    >
      <div className="form">
        <label className="field">
          <span>名前（名札の表示）</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={12} autoFocus />
        </label>
        <div className="field">
          <span>普段の居場所</span>
          <div className="seg">
            {BASES.map((b) => (
              <button key={b} type="button" className={`seg-item${base === b ? ' seg-on' : ''}`} onClick={() => setBase(b)}>
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
