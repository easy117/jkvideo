import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DanmakuItem } from '../services/types';
import { danmakuColorToCss } from '../utils/danmaku';

interface Props {
  danmakus: DanmakuItem[];
  currentTime: number;
  visible: boolean;
  onToggle: () => void;
}

interface DisplayedDanmaku extends DanmakuItem {
  _key: number;
  _fadeAnim: Animated.Value;
}

const MAX_DISPLAYED = 100;
const DRIP_INTERVAL = 250;
const FAST_DRIP_INTERVAL = 100;
const QUEUE_FAST_THRESHOLD = 50;
const SEEK_THRESHOLD = 2;

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function DanmakuList({ danmakus, currentTime, visible, onToggle }: Props) {
  const flatListRef = useRef<FlatList>(null);
  const [displayedItems, setDisplayedItems] = useState<DisplayedDanmaku[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);

  const queueRef = useRef<DanmakuItem[]>([]);
  const lastTimeRef = useRef(0);
  const processedIndexRef = useRef(0);
  const keyCounterRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const danmakusRef = useRef(danmakus);

  // Reset everything when danmakus array reference changes (video switch)
  useEffect(() => {
    if (danmakusRef.current !== danmakus) {
      danmakusRef.current = danmakus;
      queueRef.current = [];
      processedIndexRef.current = 0;
      lastTimeRef.current = 0;
      setDisplayedItems([]);
      setUnseenCount(0);
      isAtBottomRef.current = true;
    }
  }, [danmakus]);

  // Watch currentTime, enqueue new danmakus
  useEffect(() => {
    if (!visible || danmakus.length === 0) return;

    const prevTime = lastTimeRef.current;
    lastTimeRef.current = currentTime;

    // Seek detection
    if (Math.abs(currentTime - prevTime) > SEEK_THRESHOLD) {
      queueRef.current = [];
      processedIndexRef.current = 0;
      setDisplayedItems([]);
      setUnseenCount(0);
      isAtBottomRef.current = true;

      // Re-enqueue danmakus up to current time
      const catchUp = danmakus.filter(d => d.time <= currentTime);
      // Only enqueue recent ones to avoid flooding
      const tail = catchUp.slice(-20);
      queueRef.current = tail;
      processedIndexRef.current = danmakus.findIndex(
        d => d.time > currentTime
      );
      if (processedIndexRef.current === -1) {
        processedIndexRef.current = danmakus.length;
      }
      return;
    }

    // Normal progression: enqueue danmakus between prevTime and currentTime
    const sorted = danmakus; // assumed sorted by time
    let i = processedIndexRef.current;
    while (i < sorted.length && sorted[i].time <= currentTime) {
      queueRef.current.push(sorted[i]);
      i++;
    }
    processedIndexRef.current = i;
  }, [currentTime, danmakus, visible]);

  // Drip interval: pop from queue, append to displayed
  useEffect(() => {
    if (!visible) return;

    const id = setInterval(() => {
      if (queueRef.current.length === 0) return;

      const item = queueRef.current.shift()!;
      const fadeAnim = new Animated.Value(0);
      const displayed: DisplayedDanmaku = {
        ...item,
        _key: keyCounterRef.current++,
        _fadeAnim: fadeAnim,
      };

      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      setDisplayedItems(prev => {
        const next = [...prev, displayed];
        return next.length > MAX_DISPLAYED ? next.slice(-MAX_DISPLAYED) : next;
      });

      if (isAtBottomRef.current) {
        // Auto-scroll on next frame
        requestAnimationFrame(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        });
      } else {
        setUnseenCount(c => c + 1);
      }
    }, queueRef.current.length > QUEUE_FAST_THRESHOLD ? FAST_DRIP_INTERVAL : DRIP_INTERVAL);

    return () => clearInterval(id);
  }, [visible]);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      const distanceFromBottom =
        contentSize.height - layoutMeasurement.height - contentOffset.y;
      isAtBottomRef.current = distanceFromBottom < 40;
      if (isAtBottomRef.current) {
        setUnseenCount(0);
      }
    },
    []
  );

  const handleScrollBeginDrag = useCallback(() => {
    isAtBottomRef.current = false;
  }, []);

  const handlePillPress = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setUnseenCount(0);
    isAtBottomRef.current = true;
  }, []);

  const renderItem = useCallback(({ item }: { item: DisplayedDanmaku }) => {
    const dotColor = danmakuColorToCss(item.color);
    return (
      <Animated.View style={[styles.bubble, { opacity: item._fadeAnim }]}>
        <View style={[styles.colorDot, { backgroundColor: dotColor }]} />
        <Text style={styles.bubbleText} numberOfLines={3}>
          {item.text}
        </Text>
        <Text style={styles.timestamp}>{formatTimestamp(item.time)}</Text>
      </Animated.View>
    );
  }, []);

  const keyExtractor = useCallback((item: DisplayedDanmaku) => String(item._key), []);

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.7}>
        <Ionicons
          name={visible ? 'chatbubbles' : 'chatbubbles-outline'}
          size={16}
          color="#00AEEC"
        />
        <Text style={styles.headerText}>
          弹幕 {danmakus.length > 0 ? `(${danmakus.length})` : ''}
        </Text>
        <Ionicons
          name={visible ? 'chevron-up' : 'chevron-down'}
          size={14}
          color="#999"
        />
      </TouchableOpacity>

      {visible && (
        <View style={styles.listWrapper}>
          <FlatList
            ref={flatListRef}
            data={displayedItems}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            onScroll={handleScroll}
            onScrollBeginDrag={handleScrollBeginDrag}
            scrollEventThrottle={16}
            removeClippedSubviews={true}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {danmakus.length === 0 ? '暂无弹幕' : '弹幕将随视频播放显示'}
              </Text>
            }
          />
          {unseenCount > 0 && (
            <TouchableOpacity
              style={styles.pill}
              onPress={handlePillPress}
              activeOpacity={0.8}
            >
              <Text style={styles.pillText}>{unseenCount} 条新弹幕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  headerText: {
    flex: 1,
    fontSize: 13,
    color: '#212121',
    fontWeight: '500',
  },
  listWrapper: {
    height: 200,
    position: 'relative',
  },
  list: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  listContent: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginVertical: 2,
    gap: 8,
  },
  colorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    flexShrink: 0,
  },
  bubbleText: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
  timestamp: {
    fontSize: 11,
    color: '#bbb',
    marginTop: 1,
    flexShrink: 0,
  },
  pill: {
    position: 'absolute',
    bottom: 8,
    alignSelf: 'center',
    backgroundColor: '#00AEEC',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  empty: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    paddingVertical: 20,
  },
});
