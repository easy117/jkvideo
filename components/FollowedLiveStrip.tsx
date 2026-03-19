import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/authStore';
import { getFollowedLiveRooms } from '../services/bilibili';
import { LivePulse } from './LivePulse';
import { proxyImageUrl } from '../utils/imageUrl';
import type { LiveRoom } from '../services/types';

export function FollowedLiveStrip() {
  const { sessdata } = useAuthStore();
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!sessdata) return;
    getFollowedLiveRooms().then(setRooms).catch(() => {});
  }, [sessdata]);

  if (!sessdata || rooms.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>我关注的直播</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {rooms.map((room) => (
          <TouchableOpacity
            key={room.roomid}
            style={styles.item}
            onPress={() => router.push(`/live/${room.roomid}` as any)}
            activeOpacity={0.7}
          >
            <View style={styles.pulseRow}>
              <LivePulse />
            </View>
            <Image
              source={{ uri: proxyImageUrl(room.face) }}
              style={styles.avatar}
            />
            <Text style={styles.name} numberOfLines={1}>
              {room.uname.length > 5 ? room.uname.slice(0, 5) : room.uname}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f4f4f4',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: {
    fontSize: 12,
    color: '#999',
    marginBottom: 6,
  },
  scrollContent: {
    gap: 12,
    alignItems: 'center',
  },
  item: {
    alignItems: 'center',
    width: 56,
  },
  pulseRow: {
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#eee',
  },
  name: {
    fontSize: 11,
    color: '#333',
    marginTop: 4,
    textAlign: 'center',
    width: 56,
  },
});
