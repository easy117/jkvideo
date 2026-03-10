import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, TouchableOpacity, TouchableWithoutFeedback,
  Text, Modal, Image, PanResponder, useWindowDimensions,
} from 'react-native';
import Video, { VideoRef } from 'react-native-video';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { PlayUrlResponse, VideoShotData, DanmakuItem } from '../services/types';
import { buildDashMpdUri } from '../utils/dash';
import { getHeatmap, getVideoShot } from '../services/bilibili';
import { DanmakuOverlay } from './DanmakuOverlay';

const BAR_H = 3;
const BALL = 12;
const BALL_ACTIVE = 16;
const SEGMENTS = 100;
const HIDE_DELAY = 3000;

const HEADERS = {
  Referer: 'https://www.bilibili.com',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function heatColor(v: number): string {
  if (v < 0.5) {
    const t = v * 2;
    return `rgb(${Math.round(t * 255)},174,236)`;
  }
  const t = (v - 0.5) * 2;
  return `rgb(251,${Math.round((1 - t) * 114)},${Math.round((1 - t) * 153)})`;
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
    const wt = tag & 0x7;
    if (wt === 5) { floats.push(view.getFloat32(i, true)); i += 4; }
    else if (wt === 0) { while (i < bytes.length && (bytes[i++] & 0x80)); }
    else if (wt === 1) { i += 8; }
    else if (wt === 2) {
      let len = 0, shift = 0;
      do { const b = bytes[i++]; len |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; } while (true);
      i += len;
    } else break;
  }
  return floats;
}

function downsample(data: number[], n: number): number[] {
  if (!data.length) return Array(n).fill(0);
  const out = Array.from({ length: n }, (_, i) => data[Math.floor((i / n) * data.length)]);
  const max = Math.max(...out);
  return max ? out.map(v => v / max) : out;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

interface Props {
  playData: PlayUrlResponse | null;
  qualities: { qn: number; desc: string }[];
  currentQn: number;
  onQualityChange: (qn: number) => void;
  onFullscreen: () => void;
  onMiniPlayer?: () => void;
  style?: object;
  bvid?: string;
  cid?: number;
  danmakus?: DanmakuItem[];
  isFullscreen?: boolean;
  onTimeUpdate?: (t: number) => void;
  initialTime?: number;
}

export function NativeVideoPlayer({
  playData, qualities, currentQn, onQualityChange, onFullscreen, onMiniPlayer, style,
  bvid, cid, danmakus, isFullscreen, onTimeUpdate, initialTime,
}: Props) {
  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const VIDEO_H = SCREEN_W * 0.5625;

  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>();
  const isDash = !!playData?.dash;

  const [showControls, setShowControls] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [paused, setPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const durationRef = useRef(0);

  const [showQuality, setShowQuality] = useState(false);

  const [isSeeking, setIsSeeking] = useState(false);
  const isSeekingRef = useRef(false);
  const [touchX, setTouchX] = useState<number | null>(null);
  const barOffsetX = useRef(0);
  const barWidthRef = useRef(300);
  const trackRef = useRef<View>(null);

  const [heatSegments, setHeatSegments] = useState<number[]>([]);
  const [shots, setShots] = useState<VideoShotData | null>(null);
  const [showDanmaku, setShowDanmaku] = useState(true);

  const videoRef = useRef<VideoRef>(null);
  const currentDesc = qualities.find(q => q.qn === currentQn)?.desc ?? String(currentQn || 'HD');

  // URL resolution
  useEffect(() => {
    if (!playData) { setResolvedUrl(undefined); return; }
    if (isDash) {
      buildDashMpdUri(playData, currentQn)
        .then(setResolvedUrl)
        .catch(() => setResolvedUrl(playData.dash!.video[0]?.baseUrl));
    } else {
      setResolvedUrl(playData.durl?.[0]?.url);
    }
  }, [playData, currentQn]);

  // Heatmap + shots
  useEffect(() => {
    if (!bvid || !cid) return;
    let cancelled = false;
    Promise.all([getHeatmap(bvid), getVideoShot(bvid, cid)]).then(([heatmap, shotData]) => {
      if (cancelled) return;
      if (heatmap?.pb_data) {
        try { setHeatSegments(downsample(decodeFloats(heatmap.pb_data), SEGMENTS)); }
        catch { setHeatSegments([]); }
      }
      if (shotData?.image?.length) setShots(shotData);
    });
    return () => { cancelled = true; };
  }, [bvid, cid]);

  useEffect(() => { durationRef.current = duration; }, [duration]);

  const resetHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!isSeekingRef.current) {
      hideTimer.current = setTimeout(() => setShowControls(false), HIDE_DELAY);
    }
  }, []);

  const showAndReset = useCallback(() => {
    setShowControls(true);
    resetHideTimer();
  }, [resetHideTimer]);

  const handleTap = useCallback(() => {
    setShowControls(prev => {
      if (!prev) { resetHideTimer(); return true; }
      if (hideTimer.current) clearTimeout(hideTimer.current);
      return false;
    });
  }, [resetHideTimer]);

  // Start hide timer on mount
  useEffect(() => {
    resetHideTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, []);

  const measureTrack = useCallback(() => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      if (w > 0) {
        barOffsetX.current = x;
        barWidthRef.current = w;
      }
    });
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_, gs) => {
        isSeekingRef.current = true;
        setIsSeeking(true);
        setShowControls(true);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        setTouchX(clamp(gs.x0 - barOffsetX.current, 0, barWidthRef.current));
      },
      onPanResponderMove: (_, gs) => {
        setTouchX(clamp(gs.moveX - barOffsetX.current, 0, barWidthRef.current));
      },
      onPanResponderRelease: (_, gs) => {
        const ratio = clamp((gs.moveX - barOffsetX.current) / barWidthRef.current, 0, 1);
        const t = ratio * durationRef.current;
        videoRef.current?.seek(t);
        setCurrentTime(t);
        setTouchX(null);
        isSeekingRef.current = false;
        setIsSeeking(false);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => setShowControls(false), HIDE_DELAY);
      },
      onPanResponderTerminate: () => {
        setTouchX(null);
        isSeekingRef.current = false;
        setIsSeeking(false);
      },
    })
  ).current;

  const touchRatio = touchX !== null ? clamp(touchX / barWidthRef.current, 0, 1) : null;
  const progressRatio = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;

  const renderThumbnail = () => {
    if (touchRatio === null || !shots) return null;
    const { img_x_size: TW, img_y_size: TH, img_x_len, img_y_len, image } = shots;
    const totalFrames = img_x_len * img_y_len * image.length;
    const framesPerSheet = img_x_len * img_y_len;
    const frameIdx = Math.floor(touchRatio * (totalFrames - 1));
    const sheetIdx = Math.floor(frameIdx / framesPerSheet);
    const local = frameIdx % framesPerSheet;
    const col = local % img_x_len;
    const row = Math.floor(local / img_x_len);
    const left = clamp((touchX ?? 0) - TW / 2, 0, barWidthRef.current - TW);
    return (
      <View style={[styles.thumbPreview, { left, width: TW }]}>
        <View style={{ width: TW, height: TH, overflow: 'hidden', borderRadius: 4 }}>
          <Image
            source={{ uri: image[sheetIdx] }}
            style={{
              position: 'absolute',
              width: TW * img_x_len,
              height: TH * img_y_len,
              left: -col * TW,
              top: -row * TH,
            }}
          />
        </View>
        <Text style={styles.thumbTime}>{formatTime((touchRatio ?? 0) * duration)}</Text>
      </View>
    );
  };

  return (
    <TouchableWithoutFeedback onPress={handleTap}>
      <View style={[styles.container, { width: SCREEN_W, height: VIDEO_H }, style]}>
        {resolvedUrl ? (
          <Video
            key={resolvedUrl}
            ref={videoRef}
            source={isDash
              ? { uri: resolvedUrl, type: 'mpd', headers: HEADERS }
              : { uri: resolvedUrl, headers: HEADERS }
            }
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            controls={false}
            paused={paused}
            onProgress={({ currentTime: ct, seekableDuration: dur }) => {
              setCurrentTime(ct);
              if (dur > 0) setDuration(dur);
              onTimeUpdate?.(ct);
            }}
            onLoad={() => {
              if (initialTime && initialTime > 0) {
                videoRef.current?.seek(initialTime);
              }
            }}
          />
        ) : (
          <View style={styles.placeholder} />
        )}

        {isFullscreen && !!danmakus?.length && (
          <DanmakuOverlay
            danmakus={danmakus}
            currentTime={currentTime}
            screenWidth={SCREEN_W}
            screenHeight={SCREEN_H}
            visible={showDanmaku}
          />
        )}

        {showControls && (
          <>
            {/* Top bar */}
            <LinearGradient
              colors={['rgba(0,0,0,0.55)', 'transparent']}
              style={styles.topBar}
              pointerEvents="box-none"
            >
              {onMiniPlayer && (
                <TouchableOpacity onPress={onMiniPlayer} style={styles.topBtn}>
                  <Ionicons name="tablet-portrait-outline" size={20} color="#fff" />
                </TouchableOpacity>
              )}
            </LinearGradient>

            {/* Center play/pause */}
            <TouchableOpacity style={styles.centerBtn} onPress={() => { setPaused(p => !p); showAndReset(); }}>
              <View style={styles.centerBtnBg}>
                <Ionicons name={paused ? 'play' : 'pause'} size={28} color="#fff" />
              </View>
            </TouchableOpacity>

            {/* Bottom bar */}
            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.7)']}
              style={styles.bottomBar}
              pointerEvents="box-none"
            >
              {/* Thumbnail area */}
              <View style={styles.thumbArea} pointerEvents="none">
                {renderThumbnail()}
              </View>

              {/* Progress track */}
              <View
                ref={trackRef}
                style={styles.trackWrapper}
                onLayout={measureTrack}
                {...panResponder.panHandlers}
              >
                <View style={styles.track}>
                  {heatSegments.length > 0
                    ? heatSegments.map((v, i) => (
                        <View
                          key={i}
                          style={[styles.seg, { backgroundColor: heatColor(v), width: `${100 / SEGMENTS}%` as any }]}
                        />
                      ))
                    : <View style={[styles.seg, { flex: 1, backgroundColor: '#00AEEC' }]} />
                  }
                  <View style={[styles.playedOverlay, { width: `${progressRatio * 100}%` as any }]} />
                </View>
                {isSeeking && touchX !== null ? (
                  <View style={[styles.ball, styles.ballActive, { left: touchX - BALL_ACTIVE / 2 }]} />
                ) : (
                  <View style={[styles.ball, { left: progressRatio * barWidthRef.current - BALL / 2 }]} />
                )}
              </View>

              {/* Controls row */}
              <View style={styles.ctrlRow}>
                <TouchableOpacity onPress={() => { setPaused(p => !p); showAndReset(); }} style={styles.ctrlBtn}>
                  <Ionicons name={paused ? 'play' : 'pause'} size={16} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.timeText}>{formatTime(duration)}</Text>
                <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowQuality(true)}>
                  <Text style={styles.qualityText}>{currentDesc}</Text>
                </TouchableOpacity>
                {isFullscreen && (
                  <TouchableOpacity style={styles.ctrlBtn} onPress={() => setShowDanmaku(v => !v)}>
                    <Ionicons name={showDanmaku ? 'chatbubbles' : 'chatbubbles-outline'} size={16} color="#fff" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.ctrlBtn} onPress={onFullscreen}>
                  <Ionicons name="expand" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </>
        )}

        {/* Quality modal */}
        <Modal visible={showQuality} transparent animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} onPress={() => setShowQuality(false)}>
            <View style={styles.qualityList}>
              <Text style={styles.qualityTitle}>选择清晰度</Text>
              {qualities.map(q => (
                <TouchableOpacity
                  key={q.qn}
                  style={styles.qualityItem}
                  onPress={() => { setShowQuality(false); onQualityChange(q.qn); showAndReset(); }}
                >
                  <Text style={[styles.qualityItemText, q.qn === currentQn && styles.qualityItemActive]}>
                    {q.desc}
                  </Text>
                  {q.qn === currentQn && <Ionicons name="checkmark" size={16} color="#00AEEC" />}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#000' },
  placeholder: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 56,
    paddingHorizontal: 12, paddingTop: 10,
    flexDirection: 'row', justifyContent: 'flex-end',
  },
  topBtn: { padding: 6 },
  centerBtn: {
    position: 'absolute', top: '50%', left: '50%',
    transform: [{ translateX: -28 }, { translateY: -28 }],
  },
  centerBtnBg: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center', justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 8, paddingTop: 32,
  },
  thumbArea: { position: 'relative', height: 80, marginHorizontal: 8 },
  thumbPreview: { position: 'absolute', bottom: 4, alignItems: 'center' },
  thumbTime: {
    color: '#fff', fontSize: 11, fontWeight: '600', marginTop: 2,
    textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  trackWrapper: {
    marginHorizontal: 8,
    height: BAR_H + BALL_ACTIVE,
    justifyContent: 'center',
    position: 'relative',
  },
  track: {
    height: BAR_H, flexDirection: 'row',
    borderRadius: 2, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  seg: { height: BAR_H },
  playedOverlay: {
    position: 'absolute', top: 0, left: 0, height: BAR_H,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  ball: {
    position: 'absolute',
    top: (BAR_H + BALL_ACTIVE) / 2 - BALL / 2,
    width: BALL, height: BALL, borderRadius: BALL / 2,
    backgroundColor: '#fff', elevation: 3,
  },
  ballActive: {
    width: BALL_ACTIVE, height: BALL_ACTIVE, borderRadius: BALL_ACTIVE / 2,
    backgroundColor: '#00AEEC', top: 0,
  },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginTop: 4 },
  ctrlBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  timeText: { color: '#fff', fontSize: 11, marginHorizontal: 2 },
  qualityText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  qualityList: { backgroundColor: '#fff', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 16, minWidth: 180 },
  qualityTitle: { fontSize: 15, fontWeight: '700', color: '#212121', paddingVertical: 10, textAlign: 'center' },
  qualityItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#eee' },
  qualityItemText: { fontSize: 14, color: '#333' },
  qualityItemActive: { color: '#00AEEC', fontWeight: '700' },
});
