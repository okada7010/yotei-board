import { useState } from 'react';
import { newId, stamp } from '../../domain/ops';
import type { Note, NoteCategory } from '../../domain/types';
import { useBoard } from '../app/AppContext';
import { Dialog } from '../common/Dialog';

interface Props {
  category: NoteCategory;
  /** 既存の行を編集するとき */
  note: Note | null;
  onClose: () => void;
}

const DONE_LABEL: Record<NoteCategory, string | null> = {
  トラブル: '解決済みにする',
  連絡事項: null,
  来客予定: null,
  イベント: null,
};

const PLACEHOLDER: Record<NoteCategory, string> = {
  トラブル: '例：〇〇社 搬送ライン停止',
  連絡事項: '例：月末に棚卸しがあります',
  来客予定: '例：〇〇社 2名',
  イベント: '例：全体ミーティング',
};

/** 名前欄を出す区分と、その見出し・入力例（連絡事項には出さない） */
const PERSON_FIELD: Record<NoteCategory, { label: string; placeholder: string } | null> = {
  トラブル: { label: '名前（対応者）', placeholder: '例：岡田' },
  連絡事項: null,
  来客予定: { label: '名前（来客者・対応者）', placeholder: '例：〇〇社 山田様／対応 岡田' },
  イベント: { label: '名前（担当・参加者）', placeholder: '例：岡田、鈴木' },
};

export function NoteDialog({ category, note, onClose }: Props) {
  const { dispatch, device } = useBoard();
  const [text, setText] = useState(note?.text ?? '');
  const [date, setDate] = useState(note?.date ?? '');
  const [endDate, setEndDate] = useState(note?.endDate ?? '');
  const [timeStart, setTimeStart] = useState(note?.timeStart ?? '');
  const [timeEnd, setTimeEnd] = useState(note?.timeEnd ?? '');
  const [person, setPerson] = useState(note?.person ?? '');
  const personField = PERSON_FIELD[category];
  const [error, setError] = useState<string | null>(null);
  /** 日付を過ぎたら自動で表示から消える区分 */
  const expires = category === '来客予定' || category === 'イベント';
  const multiDay = Boolean(date && endDate && endDate > date);

  const build = (done: boolean): Note => {
    const now = new Date();
    const base: Note = note ?? { id: newId(), category, text: '', date: null, endDate: null, done: false, createdAt: now.toISOString(), updatedAt: '', updatedBy: '' };
    return stamp({ ...base, text: text.trim(), date: date || null, endDate: multiDay ? endDate : null, timeStart: timeStart || null, timeEnd: timeEnd || null, person: personField ? person.trim() || null : (base.person ?? null), done }, device, now);
  };

  const save = (done = false) => {
    if (!text.trim()) {
      setError('内容を入力してください');
      return;
    }
    if (!multiDay && timeStart && timeEnd && timeEnd < timeStart) {
      setError('終了の時間は、開始の時間より後にしてください');
      return;
    }
    dispatch({ type: 'upsert', collection: 'notes', record: build(done) });
    onClose();
  };

  const remove = () => {
    if (note) dispatch({ type: 'delete', collection: 'notes', id: note.id });
    onClose();
  };

  const doneLabel = DONE_LABEL[category];
  return (
    <Dialog
      title={`${category}を${note ? '編集' : '追加'}`}
      onClose={onClose}
      footer={
        <>
          {note && (
            <button type="button" className="btn btn-danger" onClick={remove}>
              削除
            </button>
          )}
          {note && doneLabel && (
            <button type="button" className="btn" onClick={() => save(true)}>
              {doneLabel}
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            やめる
          </button>
          <button type="button" className="btn btn-primary" onClick={() => save(false)}>
            保存
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field-row">
          <label className="field">
            <span>日付</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field">
            <span>終了日（複数日のとき）</span>
            <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>時間（開始）</span>
            <input type="time" value={timeStart} step={300} onChange={(e) => setTimeStart(e.target.value)} />
          </label>
          <label className="field">
            <span>時間（終了）</span>
            <input type="time" value={timeEnd} step={300} onChange={(e) => setTimeEnd(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>内容</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={120} placeholder={PLACEHOLDER[category]} autoFocus />
        </label>
        {personField && (
          <label className="field">
            <span>{personField.label}</span>
            <input type="text" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={40} placeholder={personField.placeholder} />
          </label>
        )}
        <p className="hint">日付と時間{personField && '・名前'}は空欄でも保存できます。{expires && '日付を入れると、その日を過ぎたら自動で表示から消えます。'}</p>
        {error && <p className="form-error">{error}</p>}
      </div>
    </Dialog>
  );
}
