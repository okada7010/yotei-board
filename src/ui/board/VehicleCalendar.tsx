import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, dayKind, diffDays, mondayOf, parseDate, rangeDays, weekdayLabel } from '../../domain/dates';
import { barLabel, vehicleBars, type Bar } from '../../domain/derive';
import type { DateStr, Schedule } from '../../domain/types';
import { useBoard } from '../app/AppContext';
import { moveBar, resizeBar } from './barActions';

const DAYS = 14;

interface Drag {
  key: string;
  mode: 'move' | 'start' | 'end';
  startX: number;
  startY: number;
  dayWidth: number;
  deltaDays: number;
  vehicleId: string;
  moved: boolean;
}

interface Props {
  todayStr: DateStr;
  onEdit: (initial: Partial<Schedule>) => void;
}

/** 中央上：車両ごとの2週間の予定。帯はドラッグで移動・伸縮・車両変更できる */
export function VehicleCalendar({ todayStr, onEdit }: Props) {
  const { data, dispatch, device } = useBoard();
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<{ bar: Bar; drag: Drag } | null>(null);

  const from = addDays(mondayOf(todayStr), offsetWeeks * 7);
  const days = useMemo(() => rangeDays(from, DAYS), [from]);
  const to = days[DAYS - 1];
  const vehicles = useMemo(() => data.vehicles.filter((v) => v.active).sort((a, b) => a.order - b.order), [data.vehicles]);
  const month = parseDate(from).getMonth() + 1;

  const begin = (e: ReactPointerEvent<HTMLElement>, bar: Bar, mode: Drag['mode']) => {
    e.stopPropagation();
    const lane = (e.currentTarget.closest('.lane') as HTMLElement | null)?.getBoundingClientRect();
    if (!lane) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const d: Drag = { key: bar.key, mode, startX: e.clientX, startY: e.clientY, dayWidth: lane.width / DAYS, deltaDays: 0, vehicleId: bar.vehicleId, moved: false };
    dragRef.current = { bar, drag: d };
    setDrag(d);
  };

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const cur = dragRef.current;
    if (!cur) return;
    const dx = e.clientX - cur.drag.startX;
    const dy = e.clientY - cur.drag.startY;
    const moved = cur.drag.moved || Math.abs(dx) > 6 || Math.abs(dy) > 6;
    let vehicleId = cur.drag.vehicleId;
    if (cur.drag.mode === 'move' && moved) {
      const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.vehicleId);
      if (hit instanceof HTMLElement && hit.dataset.vehicleId) vehicleId = hit.dataset.vehicleId;
    }
    const next: Drag = { ...cur.drag, deltaDays: Math.round(dx / cur.drag.dayWidth), vehicleId, moved };
    cur.drag = next;
    setDrag(next);
  };

  const finish = (commit: boolean) => {
    const cur = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!cur || !commit) return;
    const { bar, drag: d } = cur;
    if (!d.moved) {
      const first = data.schedules.find((s) => s.id === bar.scheduleIds[0]);
      if (first) onEdit(first);
      return;
    }
    const ops = d.mode === 'move' ? moveBar(data, bar, d.deltaDays, d.vehicleId, device) : resizeBar(data, bar, d.mode, d.deltaDays, device);
    if (ops.length > 0) dispatch(...ops);
  };

  const tapLane = (e: ReactPointerEvent<HTMLDivElement>, vehicleId: string) => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const index = Math.min(DAYS - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * DAYS)));
    onEdit({ vehicleId, start: days[index], end: days[index], kind: '現場', memberIds: [] });
  };

  return (
    <div className="panel vehicle-panel">
      <div className="vc-grid" style={{ gridTemplateRows: `auto repeat(${Math.max(vehicles.length, 1)}, minmax(0, 1fr))` }}>
        <div className="vc-corner">
          <button type="button" className="btn-nav" onClick={() => setOffsetWeeks((n) => n - 1)} aria-label="前の週">
            ◀
          </button>
          <span className="vc-month">
            <span className="month-big">{month}</span>月
          </span>
          <button type="button" className="btn-nav" onClick={() => setOffsetWeeks((n) => n + 1)} aria-label="次の週">
            ▶
          </button>
          {offsetWeeks !== 0 && (
            <button type="button" className="btn-nav btn-today" onClick={() => setOffsetWeeks(0)}>
              今週
            </button>
          )}
        </div>
        <div className="vc-head">
          {days.map((d) => (
            <div key={d} className={`vc-day ${dayKind(d)}${d === todayStr ? ' is-today' : ''}`}>
              <span className="vc-num">{parseDate(d).getDate()}</span>
              <span className="vc-wd">{weekdayLabel(d)}</span>
            </div>
          ))}
        </div>

        {vehicles.length === 0 && <div className="empty vc-empty">「管理」から車両を追加してください</div>}

        {vehicles.map((v) => {
          const bars = vehicleBars(data, v.id, from, to);
          // ドラッグ中に他の車両から入ってきた帯（プレビュー）
          const incoming =
            drag && drag.mode === 'move' && drag.vehicleId === v.id && dragRef.current && dragRef.current.bar.vehicleId !== v.id ? [dragRef.current.bar] : [];
          const rows = Math.max(1, ...bars.map((b) => b.row + 1));
          return (
            <div key={v.id} className="vc-row">
              <div className="vc-label">
                <span className="car-tag">{v.name}</span>
              </div>
              <div className={`lane${drag?.vehicleId === v.id && drag.moved ? ' lane-target' : ''}`} data-vehicle-id={v.id} onPointerUp={(e) => !dragRef.current && tapLane(e, v.id)}>
                {days.map((d, i) => (
                  <span key={d} className={`lane-col ${dayKind(d)}${d === todayStr ? ' is-today' : ''}`} style={{ left: `${(i / DAYS) * 100}%`, width: `${100 / DAYS}%` }} />
                ))}
                {[...bars, ...incoming].map((bar) => {
                  const active = drag?.key === bar.key ? drag : null;
                  let s = diffDays(from, bar.start);
                  let eIdx = diffDays(from, bar.end);
                  if (active) {
                    if (active.mode === 'move') {
                      s += active.deltaDays;
                      eIdx += active.deltaDays;
                    } else if (active.mode === 'start') s = Math.min(s + active.deltaDays, eIdx);
                    else eIdx = Math.max(eIdx + active.deltaDays, s);
                  }
                  const left = Math.max(0, s);
                  const right = Math.min(DAYS - 1, eIdx);
                  if (right < left) return null;
                  const ghost = active && active.mode === 'move' && active.vehicleId !== v.id && bar.vehicleId === v.id;
                  const row = incoming.includes(bar) ? 0 : bar.row;
                  return (
                    <div
                      key={bar.key + (incoming.includes(bar) ? ':in' : '')}
                      className={`bar${bar.conflict ? ' bar-conflict' : ''}${active ? ' bar-active' : ''}${ghost ? ' bar-ghost' : ''}${bar.memberNames.length === 0 ? ' bar-vehicle-only' : ''}`}
                      style={{ left: `${(left / DAYS) * 100}%`, width: `${((right - left + 1) / DAYS) * 100}%`, top: `${(row / rows) * 100}%`, height: `${100 / rows}%` }}
                      title={barLabel(bar)}
                      onPointerDown={(e) => !incoming.includes(bar) && begin(e, bar, 'move')}
                      onPointerMove={move}
                      onPointerUp={() => finish(true)}
                      onPointerCancel={() => finish(false)}
                    >
                      {!bar.openStart && <span className="bar-handle bar-handle-start" onPointerDown={(e) => begin(e, bar, 'start')} onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} />}
                      <span className="bar-text">
                        {bar.openStart ? '◂ ' : ''}
                        {barLabel(bar)}
                        {bar.openEnd ? ' ▸' : ''}
                      </span>
                      {!bar.openEnd && <span className="bar-handle bar-handle-end" onPointerDown={(e) => begin(e, bar, 'end')} onPointerMove={move} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
