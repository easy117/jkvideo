import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Image, Text, StyleSheet, Dimensions, PanResponder,
} from 'react-native';
import { getHeatmap, getVideoShot } from '../services/bilibili';
import type { VideoShotData } from '../services/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BAR_H = 4;
const BALL_SIZE = 12;
const THUMB_PREVIEW_H = 60; // space above bar for thumbnail
const CONTAINER_H = THUMB_PREVIEW_H + 16 + BAR_H + BALL_SIZE;
const SEGMENTS = 120;

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function heatColor(v: number): string {
  if (v < 0.5) {
    const t = v * 2;
    const r = Math.round(t * 255);
    return `rgb(${r},174,236)`;
  }
  const t = (v - 0.5) * 2;
  const g = Math.round((1 - t) * 114);
  const b = Math.round((1 - t) * 153);
  return `rgb(251,${g},${b})`;
}

function decodeFloats(base64: string): number[] {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const floats: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const tag = bytes[i++];
    const wireType = tag & 0x7;
    if (wireType === 5) {
      floats.push(view.getFloat32(i, true));
      i += 4;
    } else if (wireType === 0) {
      while (i < bytes.length && (bytes[i++] & 0x80));
    } else if (wireType === 1) {
      i += 8;
    } else if (wireType === 2) {
      let len = 0, shift = 0;
      do {
        const b = bytes[i++];
        len |= (b & 0x7f) << shift;
        shift += 7;
        if (!(b & 0x80)) break;
      } while (true);
      i += len;
    } else {
      break;
    }
  }
  return floats;
}

function downsample(data: number[], n: number): number[] {
  if (data.length === 0) return Array(n).fill(0);
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / n) * data.length);
    result.push(data[idx]);
  }
  const max = Math.max(...result);
  if (max === 0) return result;
  return result.map(v => v / max);
}

interface Props {
  bvid: string;
  cid: number;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}

export function HeatProgressBar({ bvid, cid, currentTime, duration, onSeek }: Props) {
  const [segments, setSegments] = useState<number[]>([]);
  const [shots, setShots] = useState<VideoShotData | null>(null);
  const [touchX, setTouchX] = useState<number | null>(null);
  const barX = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getHeatmap(bvid), getVideoShot(bvid, cid)]).then(([heatmap, shotData]) => {
      if (cancelled) return;
      if (heatmap?.pb_data) {
        try {
          const floats = decodeFloats(heatmap.pb_data);
          setSegments(downsample(floats, SEGMENTS));
        } catch {
          setSegments([]);
        }
      }
      if (shotData?.image?.length) setShots(shotData);
    });
    return () => { cancelled = true; };
  }, [bvid, cid]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gs) => {
        setTouchX(gs.x0 - barX.current);
      },
      onPanResponderMove: (_, gs) => {
        setTouchX(gs.moveX - barX.current);
      },
      onPanResponderRelease: (_, gs) => {
        const relX = gs.moveX - barX.current;
        const ratio = clamp(relX / BAR_WIDTH, 0, 1);
        onSeek(ratio * duration);
        setTouchX(null);
      },
      onPanResponderTerminate: () => setTouchX(null),
    })
  ).current;

  const BAR_WIDTH = SCREEN_WIDTH - 32;
  const progressRatio = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const touchRatio = touchX !== null ? clamp(touchX / BAR_WIDTH, 0, 1) : null;

  const renderThumbnail = () => {
    if (touchRatio === null || !shots) return null;
    const THUMB_W = shots.img_x_size;
    const THUMB_H = shots.img_y_size;
    const totalFrames = shots.img_x_len * shots.img_y_len * shots.image.length;
    const framesPerSheet = shots.img_x_len * shots.img_y_len;
    const frameIdx = Math.floor(touchRatio * (totalFrames - 1));
    const sheetIdx = Math.floor(frameIdx / framesPerSheet);
    const local = frameIdx % framesPerSheet;
    const col = local % shots.img_x_len;
    const row = Math.floor(local / shots.img_x_len);
    const thumbLeft = clamp((touchX ?? 0) - THUMB_W / 2, 0, BAR_WIDTH - THUMB_W);

    const timeLabel = formatTime(touchRatio * duration);

    return (
      <View style={[styles.thumbContainer, { left: thumbLeft, width: THUMB_W }]}>
        <View style={{ width: THUMB_W, height: THUMB_H, overflow: 'hidden', borderRadius: 4 }}>
          <Image
            source={{ uri: shots.image[sheetIdx] }}
            style={{
              position: 'absolute',
              width: THUMB_W * shots.img_x_len,
              height: THUMB_H * shots.img_y_len,
              left: -col * THUMB_W,
              top: -row * THUMB_H,
            }}
          />
        </View>
        <Text style={styles.timeLabel}>{timeLabel}</Text>
      </View>
    );
  };

  const renderTouchIndicator = () => {
    if (touchRatio === null) return null;
    return (
      <View style={[styles.touchBall, { left: touchRatio * BAR_WIDTH - BALL_SIZE / 2 }]} />
    );
  };

  return (
    <View
      style={styles.wrapper}
      onLayout={e => { barX.current = e.nativeEvent.layout.x + 16; }}
    >
      {renderThumbnail()}

      <View
        style={styles.barArea}
        {...panResponder.panHandlers}
      >
        <View style={styles.barTrack}>
          {segments.length > 0 ? (
            segments.map((v, i) => (
              <View
                key={i}
                style={[
                  styles.segment,
                  { backgroundColor: heatColor(v), width: `${100 / SEGMENTS}%` },
                ]}
              />
            ))
          ) : (
            <View style={[styles.segment, { flex: 1, backgroundColor: '#00AEEC' }]} />
          )}
          {/* played overlay */}
          <View
            style={[
              styles.playedOverlay,
              { width: `${progressRatio * 100}%` },
            ]}
          />
        </View>

        {/* progress ball */}
        <View
          style={[styles.progressBall, { left: progressRatio * BAR_WIDTH - BALL_SIZE / 2 }]}
        />

        {renderTouchIndicator()}
      </View>
    </View>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

const BAR_WIDTH = Dimensions.get('window').width - 32;

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 4,
    overflow: 'visible',
  },
  barArea: {
    height: BAR_H + BALL_SIZE,
    justifyContent: 'center',
    position: 'relative',
  },
  barTrack: {
    height: BAR_H,
    flexDirection: 'row',
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: '#e0e0e0',
  },
  segment: {
    height: BAR_H,
  },
  playedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: BAR_H,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  progressBall: {
    position: 'absolute',
    top: (BAR_H + BALL_SIZE) / 2 - BALL_SIZE / 2,
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#00AEEC',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  touchBall: {
    position: 'absolute',
    top: (BAR_H + BALL_SIZE) / 2 - BALL_SIZE / 2,
    width: BALL_SIZE,
    height: BALL_SIZE,
    borderRadius: BALL_SIZE / 2,
    backgroundColor: '#00AEEC',
    opacity: 0.8,
  },
  thumbContainer: {
    position: 'absolute',
    top: -THUMB_PREVIEW_H - 4,
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 11,
    color: '#212121',
    marginTop: 2,
    fontWeight: '600',
  },
});
