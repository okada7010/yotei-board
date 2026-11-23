import { useMemo, useState } from 'react';
import { formatShort } from '../../domain/dates';
import { overlappingSchedules, siteSuggestions, sortedMembers } from '../../domain/derive';
import { stamp } from '../../domain/ops';
import { KINDS, type Kind, type Schedule } from '../../domain/types';
import { useBoard } from '../app/AppContext';
import { newSchedule } from '../board/dropActions';
import { Dialog } from '../common/Dialog';
import { validateSchedule } from '../input/gridModel';

interface Props {
  /** id があり既存の予定なら編集、無ければ新規 */
  initial: Partial<Schedule>;
  onClose: () => void;
  /** 過去の記録など、編集できない予定を見るだけのとき */
  readOnly?: boolean;
}

export function ScheduleDialog({ initial, onClose, readOnly }: Props) {
  const { data, dispatch, device } = useBoard();
  const existing = initial.id ? (data.schedules.find((s) => s.id === initial.id) ?? null) : null;
  const base = existing ?? initial;

  const [kind, setKind] = useState<Kind>(base.kind ?? '現場');
  const [site, setSite] = useState(base.site ?? '');
  const [memberIds, setMemberIds] = useState<string[]>(base.memberIds ?? []);
  const [start, setStart] = useState(base.start ?? '');
  const [end, setEnd] = useState(base.end ?? base.start ?? '');
  const [vehicleId, setVehicleId] = useState<string | null>(base.vehicleId ?? null);
  const [memo, setMemo] = useState(base.memo ?? '');
  const [error, setError] = useState<string | null>(null);

  const members = useMemo(() => sortedMembers(data), [data]);
  const groups = useMemo(() => [...data.groups].sort((a, b) => a.order - b.order), [data.groups]);
  const vehicles = useMemo(() => data.vehicles.filter((v) => v.active || v.id === vehicleId).sort((a, b) => a.order - b.order), [data.vehicles, vehicleId]);
  const suggestions = useMemo(() => siteSuggestions(data).slice(0, 50), [data]);
  const vehicleOnly = memberIds.length === 0;

  // 同じ人・同じ期間に重なっている他の予定（参考表示）
  const overlaps = useMemo(() => {
    if (!start || memberIds.length === 0) return [];
    const seen = new Map<string, Schedule>();
    for (const id of memberIds) {
      for (const s of overlappingSchedules(data, id, start)) if (s.id !== existing?.id) seen.set(s.id, s);
    }
    return [...seen.values()];
  }, [data, memberIds, start, existing]);

  const toggleMember = (id: string) => setMemberIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = () => {
    const draft: Partial<Schedule> = {
      kind: vehicleOnly ? '現場' : kind,
      site: vehicleOnly || kind === '現場' ? site.trim() : '',
      memberIds,
      start,
      end: end || start,
      vehicleId: vehicleOnly || kind === '現場' ? vehicleId : null,
      memo: memo.trim(),
    };
    const problem = validateSchedule(draft);
    if (problem) {
      setError(problem);
      return;
    }
    const record = existing
      ? stamp({ ...existing, ...draft } as Schedule, device)
      : newSchedule(draft as Schedule, device);
    dispatch({ type: 'upsert', collection: 'schedules', record });
    onClose();
  };

  const remove = () => {
    if (existing) dispatch({ type: 'delete', collection: 'schedules', id: existing.id });
    onClose();
  };

  const title = readOnly ? '過去の記録（編集できません）' : existing ? '予定を編集' : '予定を追加';
  const footer = readOnly ? (
    <button type="button" className="btn" onClick={onClose}>
      閉じる
    </button>
  ) : (
    <>
      {existing && (
        <button type="button" className="btn btn-danger" onClick={remove}>
          削除
        </button>
      )}
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>
        やめる
      </button>
      <button type="button" className="btn btn-primary" onClick={save}>
        保存
      </button>
    </>
  );

  return (
    <Dialog title={title} onClose={onClose} footer={footer} wide>
      <fieldset disabled={readOnly} className="form">
        <div className="field">
          <span>人員（選ばなければ車両だけの予定）</span>
          <div className="member-pick">
            {groups.map((g) => {
              const list = members.filter((m) => m.groupId === g.id);
              if (list.length === 0) return null;
              return (
                <div key={g.id} className="member-pick-group">
                  <span className="member-pick-label">{g.name}</span>
                  {list.map((m) => (
                    <button key={m.id} type="button" className={`chip${memberIds.includes(m.id) ? ' chip-on' : ''}`} aria-pressed={memberIds.includes(m.id)} onClick={() => toggleMember(m.id)}>
                      {m.name}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {!vehicleOnly && (
          <div className="field">
            <span>種別</span>
            <div className="seg">
              {KINDS.map((k) => (
                <button key={k} type="button" className={`seg-item${kind === k ? ' seg-on' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>
        )}

        {(vehicleOnly || kind === '現場') && (
          <label className="field">
            <span>{vehicleOnly ? '内容（車検など）' : '現場名（出張・研修などの行き先も可）'}</span>
            <input value={site} onChange={(e) => setSite(e.target.value)} list="site-suggestions" maxLength={40} />
            <datalist id="site-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
        )}

        <div className="field-row">
          <label className="field">
            <span>開始日</span>
            <input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} />
          </label>
          <label className="field">
            <span>終了日</span>
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>

        {(vehicleOnly || kind === '現場') && (
          <label className="field">
            <span>車両</span>
            <select value={vehicleId ?? ''} onChange={(e) => setVehicleId(e.target.value || null)}>
              <option value="">使わない</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>メモ</span>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={60} />
        </label>

        {overlaps.length > 0 && (
          <div className="overlaps">
            <span>同じ日に重なっている予定：</span>
            <ul>
              {overlaps.map((s) => (
                <li key={s.id}>
                  {formatShort(s.start)}
                  {s.end !== s.start ? `〜${formatShort(s.end)}` : ''} {s.kind}
                  {s.site ? `（${s.site}）` : ''}
                </li>
              ))}
            </ul>
            <span className="hint">期間の短い予定が優先して表示されます。</span>
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
      </fieldset>
    </Dialog>
  );
}
