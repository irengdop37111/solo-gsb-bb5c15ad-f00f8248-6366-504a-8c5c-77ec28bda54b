// 冲突变化比对
// 比较“原始日历”与“规则编辑 / 例外停用后”的 LOCATION 冲突对（仅当前查询范围内的生效实例）。
// 冲突对身份：LOCATION + 双方实例身份（UID + 原始 recurrence key，无序）。
// 因此实例改期（身份不变）仍关联同一对，只体现为重叠时长变化；
// 改地点则旧地点冲突对消除、新地点冲突对新增。
// 重叠判定复用 detectConflicts：同一非空 LOCATION 下 UTC 半开区间 [start, end) 相交。

import { detectConflicts } from './conflicts';
import { instanceIdentity } from './diff';
import type { Instance } from './types';

export type ConflictChangeKind =
  | 'added' // 仅生效（候选）侧存在的冲突对
  | 'removed' // 仅原始侧存在的冲突对
  | 'changed'; // 两侧都存在但重叠时长变化

export interface ConflictPairSide {
  /** 双方实例（按实例身份字典序排列，与 identityA / identityB 对应） */
  a: Instance;
  b: Instance;
  /** 重叠时长（秒，UTC 半开区间交集长度，恒为正） */
  overlapSec: number;
}

export interface ConflictChange {
  /** 冲突对身份：LOCATION + 双方实例身份（无序） */
  key: string;
  kind: ConflictChangeKind;
  location: string;
  /** 双方实例身份（uid#原始 recurrence key），字典序 A ≤ B */
  identityA: string;
  identityB: string;
  /** 原始日历侧（removed / changed 时非空） */
  before: ConflictPairSide | null;
  /** 当前编辑侧（added / changed 时非空） */
  after: ConflictPairSide | null;
}

export const CONFLICT_CHANGE_LABEL: Record<ConflictChangeKind, string> = {
  added: '新增冲突',
  removed: '消除冲突',
  changed: '重叠变化',
};

interface PairRecord extends ConflictPairSide {
  key: string;
  location: string;
  identityA: string;
  identityB: string;
}

/** 从生效实例收集全部冲突对（复用 detectConflicts 的分组与半开区间判定） */
function collectPairs(instances: Instance[]): Map<string, PairRecord> {
  const { groups } = detectConflicts(instances);
  const pairs = new Map<string, PairRecord>();
  for (const group of groups) {
    const arr = group.instances;
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const x = arr[i];
        const y = arr[j];
        // 与 detectConflicts 一致的半开区间相交判定（相切不算冲突）
        const overlapSec = Math.min(x.endUtc, y.endUtc) - Math.max(x.startUtc, y.startUtc);
        if (overlapSec <= 0) continue;
        const idX = instanceIdentity(x);
        const idY = instanceIdentity(y);
        let identityA = idX;
        let identityB = idY;
        let a = x;
        let b = y;
        if (idY < idX) {
          identityA = idY;
          identityB = idX;
          a = y;
          b = x;
        }
        const key = `${group.location}${identityA}|${identityB}`;
        if (!pairs.has(key)) {
          pairs.set(key, {
            key,
            location: group.location,
            identityA,
            identityB,
            a,
            b,
            overlapSec,
          });
        }
      }
    }
  }
  return pairs;
}

/**
 * 比较两份生效实例集合的 LOCATION 冲突对。
 * @param baseline 原始日历展开结果（无规则编辑、无例外停用）
 * @param current  当前编辑状态下的展开结果
 */
export function diffConflicts(baseline: Instance[], current: Instance[]): ConflictChange[] {
  const before = collectPairs(baseline);
  const after = collectPairs(current);

  const changes: ConflictChange[] = [];

  for (const [key, cur] of after) {
    const prev = before.get(key);
    if (!prev) {
      changes.push({
        key,
        kind: 'added',
        location: cur.location,
        identityA: cur.identityA,
        identityB: cur.identityB,
        before: null,
        after: { a: cur.a, b: cur.b, overlapSec: cur.overlapSec },
      });
    } else if (prev.overlapSec !== cur.overlapSec) {
      changes.push({
        key,
        kind: 'changed',
        location: cur.location,
        identityA: cur.identityA,
        identityB: cur.identityB,
        before: { a: prev.a, b: prev.b, overlapSec: prev.overlapSec },
        after: { a: cur.a, b: cur.b, overlapSec: cur.overlapSec },
      });
    }
  }

  for (const [key, prev] of before) {
    if (!after.has(key)) {
      changes.push({
        key,
        kind: 'removed',
        location: prev.location,
        identityA: prev.identityA,
        identityB: prev.identityB,
        before: { a: prev.a, b: prev.b, overlapSec: prev.overlapSec },
        after: null,
      });
    }
  }

  // 按冲突对最早开始时间排序，同刻按地点与身份键决胜
  changes.sort((x, y) => {
    const tx = pairStartUtc(x);
    const ty = pairStartUtc(y);
    return tx - ty || x.location.localeCompare(y.location) || x.key.localeCompare(y.key);
  });
  return changes;
}

function pairStartUtc(c: ConflictChange): number {
  const side = c.after ?? c.before;
  return side ? Math.min(side.a.startUtc, side.b.startUtc) : 0;
}
