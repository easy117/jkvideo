import type { VideoItem, LiveRoom } from '../services/types';

export interface NormalRow {
  type: 'pair';
  left: VideoItem;
  right: VideoItem | null;
}

export interface BigRow {
  type: 'big';
  item: VideoItem;
}

export interface LiveRow {
  type: 'live';
  left: LiveRoom;
  right?: LiveRoom;
}

export type ListRow = NormalRow | BigRow | LiveRow;

export function toListRows(pages: VideoItem[][], liveRooms?: LiveRoom[]): ListRow[] {
  const rows: ListRow[] = [];
  let roomIdx = 0;

  for (const chunk of pages) {
    if (chunk.length === 0) continue;

    // Highest view count becomes BigRow
    let bigIdx = 0;
    let maxView = chunk[0].stat?.view ?? 0;
    for (let i = 1; i < chunk.length; i++) {
      const v = chunk[i].stat?.view ?? 0;
      if (v > maxView) { maxView = v; bigIdx = i; }
    }

    const bigItem = chunk[bigIdx];
    const rest = chunk.filter((_, i) => i !== bigIdx);

    const pairs: (NormalRow | LiveRow)[] = [];
    for (let i = 0; i < rest.length; i += 2) {
      if (rest[i + 1]) {
        pairs.push({ type: 'pair', left: rest[i], right: rest[i + 1] ?? null });
      }
    }



    // if (liveRooms && roomIdx < liveRooms.length && pairs.length > 0) {
    //   const seed = chunk[0]?.aid ?? 0;
    //   const insertAt = seed % (pairs.length + 1);
    //   pairs.splice(insertAt, 0, {
    //     type: 'live',
    //     left: liveRooms[roomIdx],
    //   });
    //   roomIdx++;
    // }


    if (rows.length < 20) {
      rows.push({ type: 'big', item: bigItem }, ...pairs);
    } else {
      rows.push(...pairs, { type: 'big', item: bigItem });
    }
  }
  return rows;
}
