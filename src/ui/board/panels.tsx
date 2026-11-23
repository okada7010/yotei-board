import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import { addMonths, dayKind, daysInMonth, firstOfMonth, parseDate, rangeDays } from '../../domain/dates';
import { PLACEMENT_AREAS, activeNotes, eventsOn, noteWhenText, placement, sitesOn, type Area, type EventItem } from '../../domain/derive';
import type { DateStr, Member, Note, NoteCategory } from '../../domain/types';
import { useBoard } from '../app/AppContext';
import { QrCode } from '../common/QrCode';
import { appUrl } from '../router';

/** 名札（磁石）。ドラッグでき、タップで予定を開く */
export function NameTag({ member, onTap }: { member: Member; onTap?: (m: Member) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: member.id });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={`tag${isDragging ? ' tag-dragging' : ''}`}
      {...listeners}
      {...attributes}
      onClick={() => onTap?.(member)}
    >
      {member.name}
    </button>
  );
}

function DropZone({ area, className, children }: { area: Area; className: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: area });
  return (
    <div ref={setNodeRef} className={`${className}${isOver ? ' drop-over' : ''}`}>
      {children}
    </div>
  );
}

function density(count: number): string {
  if (count > 36) return ' dense-2';
  if (count > 20) return ' dense-1';
  return '';
}

/** 左上：人の配置（LABO／本社／在宅／休み） */
export function PlacementPanel({ date, onTapMember }: { date: DateStr; onTapMember: (m: Member) => void }) {
  const { data } = useBoard();
  const p = placement(data, date);
  const total = PLACEMENT_AREAS.reduce((n, a) => n + p[a].length, 0);
  return (
    <div className={`placement${density(total)}`}>
      {PLACEMENT_AREAS.map((area) => (
        <DropZone key={area} area={area} className="placement-row">
          <span className="placement-label">{area}</span>
          <div className="tags">
            {p[area].map((m) => (
              <NameTag key={m.id} member={m} onTap={onTapMember} />
            ))}
          </div>
        </DropZone>
      ))}
    </div>
  );
}

/** 左下：現場（誰がどこへ） */
export function SitePanel({ date, onTapMember }: { date: DateStr; onTapMember: (m: Member) => void }) {
  const { data } = useBoard();
  const sites = sitesOn(data, date);
  const total = sites.reduce((n, s) => n + s.members.length, 0);
  return (
    <DropZone area="現場" className={`panel site-panel${density(total * 2)}`}>
      <div className="panel-title">現場</div>
      <div className="site-list">
        {sites.length === 0 && <p className="empty">名札をここへ動かすと現場予定を入力できます</p>}
        {sites.map((s) => (
          <div key={s.site} className="site-row">
            <div className="tags">
              {s.members.map((m) => (
                <NameTag key={m.id} member={m} onTap={onTapMember} />
              ))}
            </div>
            <span className="site-name">{s.site}</span>
          </div>
        ))}
      </div>
    </DropZone>
  );
}

/** 下段：トラブル／連絡事項／来客予定 */
export function NotesPanel({ category, date, onEdit, children }: { category: NoteCategory; date: DateStr; onEdit: (note: Note | null) => void; children?: ReactNode }) {
  const { data } = useBoard();
  const notes = activeNotes(data, category, date);
  return (
    <div className={`panel notes-panel notes-${category}`}>
      <div className="panel-title">
        {category}
        <button type="button" className="btn-add" onClick={() => onEdit(null)} aria-label={`${category}を追加`}>
          ＋
        </button>
      </div>
      <ul className="note-list">
        {notes.map((n) => (
          <li key={n.id}>
            <button type="button" className="note-item" onClick={() => onEdit(n)}>
              {noteWhenText(n) && <span className="note-date">{noteWhenText(n)}</span>}
              <span className="note-text">{n.text}</span>
              {category === 'トラブル' && <span className="trouble-dot" aria-label="発生中" />}
            </button>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/** 右上：月カレンダーとイベント */
export function EventPanel({ date, todayStr, onEditNote, onEditVehicle }: { date: DateStr; todayStr: DateStr; onEditNote: (note: Note | null) => void; onEditVehicle: (scheduleId: string) => void }) {
  const { data } = useBoard();
  const events = eventsOn(data, date);
  const first = firstOfMonth(date);
  const lead = (parseDate(first).getDay() + 6) % 7; // 月曜始まり
  const days = rangeDays(first, daysInMonth(date));
  const month = parseDate(first).getMonth() + 1;
  const next = addMonths(first, 1);
  const open = (e: EventItem) => {
    if (e.source === 'vehicle') onEditVehicle(e.refId);
    else onEditNote(data.notes.find((n) => n.id === e.refId) ?? null);
  };
  return (
    <div className="panel event-panel">
      <div className="panel-title">
        <span className="month-big">{month}</span>月
        <button type="button" className="btn-add" onClick={() => onEditNote(null)} aria-label="イベントを追加">
          ＋
        </button>
      </div>
      <div className="mini-cal" aria-label={`${month}月のカレンダー`}>
        {['月', '火', '水', '木', '金', '土', '日'].map((w, i) => (
          <span key={w} className={`mini-head${i === 5 ? ' sat' : i === 6 ? ' sun' : ''}`}>
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} />
        ))}
        {days.map((d) => (
          <span key={d} className={`mini-day ${dayKind(d)}${d === todayStr ? ' is-today' : ''}${d === date && d !== todayStr ? ' is-view' : ''}`}>
            {parseDate(d).getDate()}
          </span>
        ))}
      </div>
      <ul className="event-list">
        {events.map((e) => (
          <li key={e.key}>
            <button type="button" className="event-item" onClick={() => open(e)}>
              {noteWhenText(e) && <span className="note-date">{noteWhenText(e)}</span>}
              <span className="note-text">{e.text}</span>
            </button>
          </li>
        ))}
        {events.length === 0 && <li className="empty">{parseDate(next).getMonth() + 1}月までの予定はありません</li>}
      </ul>
    </div>
  );
}

/** 来客予定欄の右下：操作画面を開く QR コードと URL（URL のみ。鍵は含まない） */
export function QrCorner() {
  const url = appUrl('/input');
  return (
    <div className="qr-corner">
      <QrCode text={url} className="qr-img" />
      <div className="qr-text">
        <span className="qr-label">操作画面</span>
        <span className="qr-url">{url.replace(/^https?:\/\//, '')}</span>
      </div>
    </div>
  );
}
