import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassSurface } from '@/components/glass-surface';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { createDeck, decksWithCounts, deleteDeck, updateDeck } from '@/db/queries';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Compact "time since last study" label (e.g. "5m", "3h", "2d"). Returns null
// when the deck was never studied so the caller can hide the label entirely.
// Months use 30d and years use 365d — close enough for a glanceable hint.
function formatTimeSince(ms: number | null): string | null {
  if (ms == null) return null;
  const diff = Date.now() - ms;
  if (diff < 0) return null;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (d < 30) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (d < 365) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

export default function DecksScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  // useLiveQuery only reacts to its own FROM table (decks), so per-deck card
  // counts wouldn't update. Re-read on focus and after each mutation instead.
  const [decks, setDecks] = useState(() => decksWithCounts().all());
  const refresh = useCallback(() => setDecks(decksWithCounts().all()), []);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  // Hold a deck → native action sheet: rename or delete. Rename uses
  // Alert.prompt (the same primitive as deck creation) since the only editable
  // field is a one-line name — no need for a full screen.
  function showDeckMenu(item: { id: number; name: string }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.name,
        options: ['Cancel', 'Edit name', 'Delete deck'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 0,
      },
      (i) => {
        if (i === 1) {
          Alert.prompt(
            'Rename deck',
            undefined,
            (name) => {
              const trimmed = name?.trim();
              if (trimmed && trimmed !== item.name) {
                updateDeck(item.id, { name: trimmed });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                refresh();
              }
            },
            'plain-text',
            item.name
          );
        } else if (i === 2) {
          deleteDeck(item.id);
          refresh();
        }
      }
    );
  }

  function handleAddDeck() {
    Alert.prompt('New deck', 'What should it be called?', (name) => {
      const trimmed = name?.trim();
      if (trimmed) {
        createDeck(trimmed);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        refresh();
      }
    });
  }

  const bg: [string, string] =
    scheme === 'dark' ? ['#101114', '#000000'] : ['#EEF2FB', '#F7F8FC'];

  return (
    <View style={styles.root}>
      <LinearGradient colors={bg} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <ThemedText style={styles.largeTitle}>Decks</ThemedText>
          <Pressable
            onPress={handleAddDeck}
            hitSlop={12}
            style={({ pressed }) => [styles.addShadow, { opacity: pressed ? 0.6 : 1 }]}>
            <GlassSurface radius={19} style={styles.addButton}>
              <ThemedText style={[styles.addButtonText, { color: colors.tint }]}>＋</ThemedText>
            </GlassSurface>
          </Pressable>
        </View>

        <FlatList
          data={decks}
          keyExtractor={(d) => String(d.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: colors.textSecondary }]}>
              No decks yet.{'\n'}Tap ＋ to create your first one.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Animated.View layout={LinearTransition} exiting={FadeOut.duration(220)}>
            <SwipeToDelete radius={20} onConfirm={() => { deleteDeck(item.id); refresh(); }}>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                router.push({ pathname: '/deck/[id]', params: { id: String(item.id) } });
              }}
              onLongPress={() => showDeckMenu(item)}
              delayLongPress={350}
              style={({ pressed }) => [
                styles.cardShadow,
                { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
              ]}>
              <GlassSurface radius={20} style={styles.deckRow}>
                <View style={styles.deckInfo}>
                  <ThemedText style={styles.deckName}>{item.name}</ThemedText>
                  <ThemedText style={[styles.deckMeta, { color: colors.textSecondary }]}>
                    {item.total} {item.total === 1 ? 'card' : 'cards'}
                  </ThemedText>
                </View>
                {formatTimeSince(item.lastStudied) && (
                  <ThemedText style={[styles.lastStudied, { color: colors.textSecondary }]}>
                    {formatTimeSince(item.lastStudied)}
                  </ThemedText>
                )}
              </GlassSurface>
            </Pressable>
            </SwipeToDelete>
            </Animated.View>
          )}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Wider side padding keeps cards off the screen edge, so the iOS back/navigation
  // swipe (which lives at the edge) doesn't land on a row and trigger delete.
  safe: { flex: 1, paddingHorizontal: Spacing.four },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  largeTitle: { fontSize: 34, fontWeight: '700', lineHeight: 41 },
  addShadow: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  addButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { fontSize: 22, lineHeight: 24, fontWeight: '500' },
  list: { gap: Spacing.two, paddingBottom: 120 },
  empty: { textAlign: 'center', marginTop: Spacing.six, fontSize: 15, lineHeight: 22 },
  cardShadow: {
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
  },
  deckInfo: { flex: 1, gap: 2 },
  deckName: { fontSize: 17, fontWeight: '600' },
  deckMeta: { fontSize: 13, lineHeight: 18 },
  lastStudied: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
