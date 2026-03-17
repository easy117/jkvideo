import { useState, useEffect, useRef } from 'react';
import pako from 'pako';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLiveDanmakuInfo } from '../services/bilibili';
import type { DanmakuItem } from '../services/types';

// Read big-endian values directly from Uint8Array (avoids DataView offset issues)
function r32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function r16(b: Uint8Array, o: number): number {
  return ((b[o] << 8) | b[o + 1]) >>> 0;
}

// Build packet using raw bit ops – avoids DataView / TextEncoder quirks in Hermes.
// Returns Uint8Array so ws.send() takes the ArrayBufferView path directly.
function buildPacket(body: string, op: number): Uint8Array {
  const n = body.length; // JSON is ASCII-safe
  const total = 16 + n;
  const pkt = new Uint8Array(total);
  // total_len (big-endian uint32)
  pkt[0] = (total >>> 24) & 0xff;
  pkt[1] = (total >>> 16) & 0xff;
  pkt[2] = (total >>> 8) & 0xff;
  pkt[3] = total & 0xff;
  // header_len = 16 (big-endian uint16)
  pkt[4] = 0x00; pkt[5] = 0x10;
  // ver = 1
  pkt[6] = 0x00; pkt[7] = 0x01;
  // op (big-endian uint32)
  pkt[8] = (op >>> 24) & 0xff;
  pkt[9] = (op >>> 16) & 0xff;
  pkt[10] = (op >>> 8) & 0xff;
  pkt[11] = op & 0xff;
  // seq = 1
  pkt[12] = 0x00; pkt[13] = 0x00; pkt[14] = 0x00; pkt[15] = 0x01;
  // body (ASCII chars)
  for (let i = 0; i < n; i++) pkt[16 + i] = body.charCodeAt(i) & 0xff;
  return pkt;
}

interface RawPacket {
  op: number;
  ver: number;
  body: Uint8Array;
}

function parseRawPackets(buf: Uint8Array): RawPacket[] {
  const packets: RawPacket[] = [];
  let offset = 0;
  while (offset + 16 <= buf.length) {
    const totalLen = r32(buf, offset);
    const headerLen = r16(buf, offset + 4);
    const ver = r16(buf, offset + 6);
    const op = r32(buf, offset + 8);
    if (totalLen < headerLen || offset + totalLen > buf.length) break;
    packets.push({ op, ver, body: buf.slice(offset + headerLen, offset + totalLen) });
    offset += totalLen;
  }
  return packets;
}

function extractDanmaku(buf: Uint8Array): DanmakuItem[] {
  const result: DanmakuItem[] = [];
  for (const pkt of parseRawPackets(buf)) {
    if (pkt.op !== 5) continue;
    if (pkt.ver === 2) {
      //  ver=2: zlib-compressed JSON array of messages 
      try {
        result.push(...extractDanmaku(pako.inflate(pkt.body)));
      } catch { /* ignore decompression errors */ }
    } else {
      // ver=0 or ver=1: raw JSON
      try {
        const msg = JSON.parse(new TextDecoder().decode(pkt.body));
        if (msg.cmd === 'DANMU_MSG') {
          const info = msg.info;
          const text = info[1] as string;
          // color is at info[0][2] (decimal 0xRRGGBB)
          const color = (info[0]?.[2] as number) ?? 0xffffff;
          const uname = info[2]?.[1] as string | undefined;
          const isAdmin = info[2]?.[2] === 1;
          const guardLevel = (info[7] as number) ?? 0;
          const medalLevel = Array.isArray(info[3]) && info[3].length > 0 ? info[3][0] as number : undefined;
          const medalName = Array.isArray(info[3]) && info[3].length > 1 ? info[3][1] as string : undefined;
          result.push({ time: 0, mode: 1, fontSize: 25, color, text, uname, isAdmin, guardLevel, medalLevel, medalName });
        }
      } catch { /* ignore parse errors */ }
    }
  }
  return result;
}

// Normalize message data to Uint8Array.
// React Native may deliver binary WebSocket frames as base64 strings instead of ArrayBuffer.
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') {
    try {
      const bStr = atob(data);
      const bytes = new Uint8Array(bStr.length);
      for (let i = 0; i < bStr.length; i++) bytes[i] = bStr.charCodeAt(i);
      return bytes;
    } catch { return null; }
  }
  return null;
}

export function useLiveDanmaku(roomId: number): DanmakuItem[] {
  const [danmakus, setDanmakus] = useState<DanmakuItem[]>([]);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!roomId) return;
    setDanmakus([]);
    let cancelled = false;

    async function connect() {
      let token = '';
      let host = 'wss://broadcastlv.chat.bilibili.com/sub';
      try {
        const info = await getLiveDanmakuInfo(roomId);
        token = info.token;
        host = info.host;


      } catch (e) {
        console.warn('[danmaku] getDanmuInfo failed:', e);
      }
      if (cancelled) return;

      // Bilibili requires buvid3 cookie for auth; React Native doesn't send cookies
      // automatically, so we pass it via the non-standard options.headers argument.
      const [buvid3, sessdata] = await Promise.all([
        AsyncStorage.getItem('buvid3'),
        AsyncStorage.getItem('SESSDATA'),
      ]);
      const cookieParts = buvid3 ? [`buvid3=${buvid3}`] : [];
      if (sessdata) cookieParts.push(`SESSDATA=${sessdata}`);

      // React Native supports non-standard options.headers in the WebSocket constructor
      const ws = new (WebSocket as any)(host, [], {
        headers: cookieParts.length ? { Cookie: cookieParts.join('; ') } : {},
      }) as WebSocket;
      wsRef.current = ws;

      ws.onopen = () => {

        const authBody = JSON.stringify({
          uid: 0,
          roomid: roomId,
          protover: 2,
          platform: 'h5',
          type: 2,
          key: token,
        });
        const authPkt = buildPacket(authBody, 7);


        ws.send(authPkt.buffer as ArrayBuffer);

        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(buildPacket('', 2));
        }, 30000);
      };

      ws.onmessage = (e: MessageEvent) => {
        const bytes = toBytes(e.data);
        if (!bytes) return;
        const items = extractDanmaku(bytes);
        if (items.length > 0) setDanmakus(prev => [...prev, ...items]);
      };

      ws.onerror = () => {};
      ws.onclose = () => {
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current?.close();
    };
  }, [roomId]);

  return danmakus;
}
