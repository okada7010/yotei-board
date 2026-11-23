import { useEffect, useMemo, useRef, useState } from 'react';
import { toDateStr } from '../../domain/dates';
import { makeBackup, parseBackup, stamp, type AnyRecord, type Collection, type Op } from '../../domain/ops';
import { BASES, type Base, type BoardData, type Member } from '../../domain/types';
import { deviceName, encodeRegistration, loadRegistration, saveRegistration, setDeviceName } from '../../data/registration';
import { LocalRepository } from '../../data/localRepository';
import { useBoard } from '../app/AppContext';
import { Dialog } from '../common/Dialog';
import { QrCode } from '../common/QrCode';
import { StatusBar } from '../common/StatusBar';
import { DEMO_KEY } from '../RegisterPage';
import type { Route } from '../router';
import { addGroup, addMember, addVehicle, canDeleteGroup, moveOrder } from './adminActions';

type Tab = 'members' | 'groups' | 'vehicles' | 'device';
const TABS: [Tab, string][] = [
  ['members', '人員'],
  ['groups', 'グループ'],
  ['vehicles', '車両'],
  ['device', '端末・バックアップ'],
];

export function AdminPage({ navigate }: { navigate: (p: Route) => void }) {
  const [tab, setTab] = useState<Tab>('members');
  return (
    <div className="page admin-page">
      <header className="page-bar">
        <button type="button" className="btn" onClick={() => navigate('/board')}>
          ← ボード
        </button>
        <h1>管理</h1>
        <StatusBar />
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => navigate('/input')}>
          予定入力
        </button>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? ' tab-on' : ''}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="admin-body">
        {tab === 'members' && <MembersTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'vehicles' && <VehiclesTab />}
        {tab === 'device' && <DeviceTab />}
      </div>
    </div>
  );
}

/** 名前をその場で編集する入力欄（確定はフォーカスを外したとき／Enter） */
function NameInput({ value, onCommit, maxLength = 20 }: { value: string; onCommit: (v: string) => void; maxLength?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = text.trim();
    if (t && t !== value) onCommit(t);
    else setText(value);
  };
  return <input className="name-input" value={text} maxLength={maxLength} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function useEdit() {
  const { dispatch, device } = useBoard();
  return <T extends AnyRecord>(collection: Collection, record: T, patch: Partial<T>) =>
    dispatch({ type: 'upsert', collection, record: stamp({ ...record, ...patch }, device) });
}

function OrderButtons({ onMove, first, last }: { onMove: (dir: -1 | 1) => void; first: boolean; last: boolean }) {
  return (
    <span className="order-btns">
      <button type="button" className="btn btn-small" disabled={first} onClick={() => onMove(-1)} aria-label="上へ">
        ↑
      </button>
      <button type="button" className="btn btn-small" disabled={last} onClick={() => onMove(1)} aria-label="下へ">
        ↓
      </button>
    </span>
  );
}

function MembersTab() {
  const { data, dispatch, device } = useBoard();
  const edit = useEdit();
  const groups = useMemo(() => [...data.groups].sort((a, b) => a.order - b.order), [data.groups]);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [base, setBase] = useState<Base>('LABO');
  const [showHidden, setShowHidden] = useState(false);
  const targetGroup = groupId || groups[0]?.id || '';

  const add = () => {
    if (!targetGroup) return;
    dispatch(...addMember(data, name, targetGroup, base, device));
    setName('');
  };

  if (groups.length === 0) return <p className="empty">先に「グループ」を追加してください。</p>;
  const hiddenCount = data.members.filter((m) => !m.active).length;

  return (
    <>
      <div className="add-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名前（名札の表示）" maxLength={12} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <select value={targetGroup} onChange={(e) => setGroupId(e.target.value)} aria-label="グループ">
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={base} onChange={(e) => setBase(e.target.value as Base)} aria-label="普段の居場所">
          {BASES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={add}>
          人員を追加
        </button>
      </div>

      {groups.map((g) => {
        const list = data.members.filter((m) => m.groupId === g.id && (showHidden || m.active)).sort((a, b) => a.order - b.order);
        const activeList = list.filter((m) => m.active);
        return (
          <section key={g.id} className="admin-group">
            <h3>{g.name}</h3>
            {list.length === 0 && <p className="empty">人員がいません</p>}
            {list.map((m: Member) => {
              const idx = activeList.findIndex((x) => x.id === m.id);
              return (
                <div key={m.id} className={`admin-row${m.active ? '' : ' is-hidden'}`}>
                  <NameInput value={m.name} maxLength={12} onCommit={(v) => edit('members', m, { name: v })} />
                  <select value={m.groupId} onChange={(e) => edit('members', m, { groupId: e.target.value })} aria-label="グループ">
                    {groups.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <select value={m.base} onChange={(e) => edit('members', m, { base: e.target.value as Base })} aria-label="普段の居場所">
                    {BASES.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  {m.active ? (
                    <OrderButtons first={idx <= 0} last={idx === activeList.length - 1} onMove={(dir) => dispatch(...moveOrder('members', activeList, m.id, dir, device))} />
                  ) : (
                    <span className="order-btns" />
                  )}
                  <button type="button" className="btn btn-small" onClick={() => edit('members', m, { active: !m.active })}>
                    {m.active ? '非表示にする' : '表示に戻す'}
                  </button>
                </div>
              );
            })}
          </section>
        );
      })}
      {hiddenCount > 0 && (
        <label className="check">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> 非表示の人員も表示する（{hiddenCount}名）
        </label>
      )}
      <p className="hint">退職・異動した人は「非表示にする」を使ってください。過去の予定は残ります。</p>
    </>
  );
}

function GroupsTab() {
  const { data, dispatch, device } = useBoard();
  const edit = useEdit();
  const groups = useMemo(() => [...data.groups].sort((a, b) => a.order - b.order), [data.groups]);
  const [name, setName] = useState('');
  const add = () => {
    dispatch(...addGroup(data, name, device));
    setName('');
  };
  return (
    <>
      <div className="add-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="グループ名" maxLength={20} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={add}>
          グループを追加
        </button>
      </div>
      {groups.map((g, i) => {
        const count = data.members.filter((m) => m.groupId === g.id).length;
        return (
          <div key={g.id} className="admin-row">
            <NameInput value={g.name} onCommit={(v) => edit('groups', g, { name: v })} />
            <span className="count">{count}名</span>
            <OrderButtons first={i === 0} last={i === groups.length - 1} onMove={(dir) => dispatch(...moveOrder('groups', groups, g.id, dir, device))} />
            <button type="button" className="btn btn-small btn-danger" disabled={!canDeleteGroup(data, g.id)} onClick={() => dispatch({ type: 'delete', collection: 'groups', id: g.id })} title={canDeleteGroup(data, g.id) ? undefined : '所属している人員（非表示を含む）がいるため削除できません'}>
              削除
            </button>
          </div>
        );
      })}
      <p className="hint">人員が所属しているグループは削除できません。先に人員を別のグループへ移してください。</p>
    </>
  );
}

function VehiclesTab() {
  const { data, dispatch, device } = useBoard();
  const edit = useEdit();
  const vehicles = useMemo(() => [...data.vehicles].sort((a, b) => Number(b.active) - Number(a.active) || a.order - b.order), [data.vehicles]);
  const activeList = vehicles.filter((v) => v.active);
  const [name, setName] = useState('');
  const add = () => {
    dispatch(...addVehicle(data, name, device));
    setName('');
  };
  return (
    <>
      <div className="add-row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="車両名" maxLength={16} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={add}>
          車両を追加
        </button>
      </div>
      {vehicles.map((v) => {
        const idx = activeList.findIndex((x) => x.id === v.id);
        return (
          <div key={v.id} className={`admin-row${v.active ? '' : ' is-hidden'}`}>
            <NameInput value={v.name} maxLength={16} onCommit={(n) => edit('vehicles', v, { name: n })} />
            {v.active ? <OrderButtons first={idx <= 0} last={idx === activeList.length - 1} onMove={(dir) => dispatch(...moveOrder('vehicles', activeList, v.id, dir, device))} /> : <span className="order-btns" />}
            <button type="button" className="btn btn-small" onClick={() => edit('vehicles', v, { active: !v.active })}>
              {v.active ? '非表示にする' : '表示に戻す'}
            </button>
          </div>
        );
      })}
      {vehicles.length === 0 && <p className="empty">車両がありません</p>}
    </>
  );
}

function downloadBackup(data: BoardData): void {
  const blob = new Blob([JSON.stringify(makeBackup(data), null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yotei-board-backup-${toDateStr(new Date()).replace(/-/g, '')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function DeviceTab() {
  const { data, dispatch, mode, store, pendingCount } = useBoard();
  const [name, setName] = useState(deviceName());
  const [saved, setSaved] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [restore, setRestore] = useState<BoardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reg = mode === 'github' ? loadRegistration() : null;
  const code = reg ? encodeRegistration(reg) : null;

  // 登録コードは鍵そのものなので、表示は60秒で自動的に隠す
  useEffect(() => {
    if (!showCode) return;
    const id = setTimeout(() => setShowCode(false), 60000);
    return () => clearTimeout(id);
  }, [showCode]);

  const onFile = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    try {
      setRestore(parseBackup(await file.text()));
    } catch (e) {
      setError((e as Error).message);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const unregister = async () => {
    await store.flush();
    saveRegistration(null);
    localStorage.removeItem(DEMO_KEY);
    window.location.hash = '';
    window.location.reload();
  };

  return (
    <>
      <section className="admin-group">
        <h3>この端末</h3>
        <div className="add-row">
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} maxLength={30} placeholder="端末名" />
          <button type="button" className="btn" disabled={!name.trim()} onClick={() => { setDeviceName(name); setSaved(true); }}>
            端末名を保存
          </button>
          {saved && <span className="hint">保存しました（次に開いたときから変更履歴に反映されます）</span>}
        </div>
        {mode === 'github' ? (
          <p className="hint">接続先：GitHub（登録済み）</p>
        ) : (
          <p className="hint">お試しモード：データはこの端末のブラウザ内だけに保存されています。</p>
        )}
      </section>

      {code && (
        <section className="admin-group">
          <h3>別の端末を登録する</h3>
          <p className="hint">登録コードは鍵そのものです。周りに人がいないことを確かめてから表示してください。60秒で自動的に隠れます。</p>
          {showCode ? (
            <div className="code-show">
              <QrCode text={code} className="qr-big" />
              <textarea className="code-out" readOnly rows={5} value={code} onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={() => setShowCode(false)}>
                隠す
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => setShowCode(true)}>
              登録コードを表示
            </button>
          )}
        </section>
      )}

      <section className="admin-group">
        <h3>バックアップ</h3>
        <p className="hint">全データを1つのファイルに書き出します。月1回程度の書き出しをおすすめします。</p>
        <div className="add-row">
          <button type="button" className="btn" onClick={() => downloadBackup(data)}>
            バックアップを書き出す
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            バックアップから戻す…
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>

      <section className="admin-group">
        <h3>登録の解除</h3>
        <p className="hint">この端末から鍵を消し、端末登録画面に戻します。{mode === 'local' && 'お試しモードを終了します（お試しデータは残ります）。'}</p>
        <div className="add-row">
          <button type="button" className="btn btn-danger" onClick={() => void unregister()}>
            {mode === 'local' ? 'お試しモードを終了' : 'この端末の登録を解除'}
          </button>
          {mode === 'local' && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                LocalRepository.reset();
                window.location.reload();
              }}
            >
              お試しデータを初期状態に戻す
            </button>
          )}
        </div>
        {pendingCount > 0 && <p className="hint">保存待ちの変更は、解除の前に保存を試みます。</p>}
      </section>

      {restore && (
        <Dialog
          title="バックアップから戻す"
          onClose={() => setRestore(null)}
          footer={
            <>
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setRestore(null)}>
                やめる
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const op: Op = { type: 'replaceAll', data: restore };
                  dispatch(op);
                  setRestore(null);
                }}
              >
                置き換える
              </button>
            </>
          }
        >
          <p>現在のデータをすべて、バックアップの内容に置き換えます。</p>
          <p className="hint">
            バックアップの内容：人員 {restore.members.length}名／車両 {restore.vehicles.length}台／予定 {restore.schedules.length}件／掲示 {restore.notes.length}件
          </p>
          <p className="form-error">全員の画面に反映されます。この操作は取り消せません（GitHub の変更履歴からは戻せます）。</p>
        </Dialog>
      )}
    </>
  );
}
