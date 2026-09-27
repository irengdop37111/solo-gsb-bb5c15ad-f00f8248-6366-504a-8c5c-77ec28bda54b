import { useMemo, useState } from 'react';
import type { Instance } from '../ical-engine/types';
import {
  CONFLICT_CHANGE_LABEL,
  type ConflictChange,
  type ConflictChangeKind,
  type ConflictPairSide,
} from '../ical-engine/conflict-diff';
import { formatDuration, formatWall } from '../utils/format';

interface ConflictChangesProps {
  changes: ConflictChange[];
  onSelect: (change: ConflictChange) => void;
}

const FILTER_KINDS: ConflictChangeKind[] = ['added', 'removed', 'changed'];

/**
 * 冲突变化面板：逐对列出原始日历与当前编辑状态之间的 LOCATION 冲突差异
 * （新增 / 消除 / 持续但重叠时长变化）。点击行联动实例表与 ICS 源码定位双方实例。
 */
export function ConflictChanges({ changes, onSelect }: ConflictChangesProps) {
  const [filter, setFilter] = useState<ConflictChangeKind | 'all'>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const counts = useMemo(() => {
    const map = new Map<ConflictChangeKind, number>();
    for (const c of changes) map.set(c.kind, (map.get(c.kind) ?? 0) + 1);
    return map;
  }, [changes]);

  const rows = useMemo(
    () => (filter === 'all' ? changes : changes.filter((c) => c.kind === filter)),
    [changes, filter]
  );

  return (
    <>
      <div className="filter-bar diff-filter">
        <button
          className={filter === 'all' ? 'chip active' : 'chip'}
          onClick={() => setFilter('all')}
        >
          全部（{changes.length}）
        </button>
        {FILTER_KINDS.map((k) => (
          <button
            key={k}
            className={`chip cc-${k} ${filter === k ? 'active' : ''}`}
            onClick={() => setFilter(k)}
            disabled={!counts.has(k)}
          >
            {CONFLICT_CHANGE_LABEL[k]}（{counts.get(k) ?? 0}）
          </button>
        ))}
      </div>

      {changes.length === 0 ? (
        <div className="empty-hint diff-empty">
          <div style={{ fontSize: 28, marginBottom: 6 }}>🕊️</div>
          当前范围内冲突没有变化
          <div className="clock" style={{ marginTop: 4 }}>
            编辑 RRULE 或停用例外后，这里会立即重算新增 / 消除 / 重叠时长变化的冲突对
          </div>
        </div>
      ) : (
        <div className="diff-list">
          {rows.map((c) => (
            <ConflictChangeRow
              key={c.key}
              change={c}
              selected={selectedKey === c.key}
              onClick={() => {
                setSelectedKey(c.key);
                onSelect(c);
              }}
            />
          ))}
          {rows.length === 0 && (
            <div className="empty-hint">该变化类型下没有匹配项</div>
          )}
        </div>
      )}
    </>
  );
}

function ConflictChangeRow({
  change,
  selected,
  onClick,
}: {
  change: ConflictChange;
  selected: boolean;
  onClick: () => void;
}) {
  const side = change.after ?? change.before;
  if (!side) return null;
  return (
    <div
      className={`diff-row cc-${change.kind} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      title="点击定位双方实例与 ICS 原文"
    >
      <div className="diff-head">
        <span className={`diff-badge cc-${change.kind}`}>
          {CONFLICT_CHANGE_LABEL[change.kind]}
        </span>
        <span className="cc-loc" title={`LOCATION: ${change.location}`}>
          {change.location}
        </span>
        <span className="diff-title">
          {side.a.summary || '（无标题）'} × {side.b.summary || '（无标题）'}
        </span>
      </div>
      <div className="diff-ident clock">
        实例对（UID#原始 recurrence key）：
        <span className="diff-key-mono">{change.identityA}</span>
        {' × '}
        <span className="diff-key-mono">{change.identityB}</span>
      </div>
      {change.kind === 'added' && change.after && (
        <SideFields side={change.after} tone="after" note="（原始日历中不冲突）" />
      )}
      {change.kind === 'removed' && change.before && (
        <SideFields side={change.before} tone="before" note="（生效列表中已不冲突）" />
      )}
      {change.kind === 'changed' && change.before && change.after && (
        <ChangedFields before={change.before} after={change.after} />
      )}
    </div>
  );
}

/** 新增 / 消除：展示该侧双方实例区间与重叠时长 */
function SideFields({
  side,
  tone,
  note,
}: {
  side: ConflictPairSide;
  tone: 'before' | 'after';
  note: string;
}) {
  return (
    <div className="diff-fields">
      <InstLine inst={side.a} tone={tone} />
      <InstLine inst={side.b} tone={tone} />
      <div className="field-diff">
        <span className="field-name">重叠</span>
        <span className={`val ${tone}`}>{overlapText(side)}</span>
        <span className="clock">{note}</span>
      </div>
    </div>
  );
}

function InstLine({ inst, tone }: { inst: Instance; tone: 'before' | 'after' }) {
  return (
    <div className="field-diff">
      <span className="field-name">实例</span>
      <span className={`val ${tone}`}>
        {intervalText(inst)} · {inst.summary || '（无标题）'}
      </span>
    </div>
  );
}

/** 重叠变化：重叠时长前后对比 + 双方实例区间前后对比 */
function ChangedFields({
  before,
  after,
}: {
  before: ConflictPairSide;
  after: ConflictPairSide;
}) {
  return (
    <div className="diff-fields">
      <div className="field-diff">
        <span className="field-name">重叠</span>
        <span className="val before">{overlapText(before)}</span>
        <span className="arrow">→</span>
        <span className="val after">{overlapText(after)}</span>
      </div>
      <MoveLine before={before.a} after={after.a} />
      <MoveLine before={before.b} after={after.b} />
    </div>
  );
}

function MoveLine({ before, after }: { before: Instance; after: Instance }) {
  const moved = before.startUtc !== after.startUtc || before.endUtc !== after.endUtc;
  return (
    <div className="field-diff">
      <span className="field-name">实例</span>
      {moved ? (
        <>
          <span className="val before">
            {before.summary || '（无标题）'} · {intervalText(before)}
          </span>
          <span className="arrow">→</span>
          <span className="val after">
            {after.summary || '（无标题）'} · {intervalText(after)}
          </span>
        </>
      ) : (
        <span className="val">
          {after.summary || '（无标题）'} · {intervalText(after)}
        </span>
      )}
    </div>
  );
}

function intervalText(inst: Instance): string {
  return `${formatWall(inst.startUtc, inst.tzid, inst.isAllDay)} – ${formatWall(inst.endUtc, inst.tzid, inst.isAllDay)}`;
}

function overlapText(side: ConflictPairSide): string {
  return formatDuration(side.overlapSec, side.a.isAllDay && side.b.isAllDay);
}
