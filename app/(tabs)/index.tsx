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
import { createDeck, decksWithCounts, deleteDeck } from '@/db/queries';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function DecksScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  // useLiveQuery only reacts to its own FROM table (decks), so per-deck card
  // counts wouldn't update. Re-read on focus and after each mutation instead.
  const [decks, setDecks] = useState(() => decksWithCounts().all());
  const refresh = useCallback(() => setDecks(decksWithCounts().all()), []);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  // Hold a deck → native action sheet with options (currently Delete).
  function showDeckMenu(item: { id: number; name: string }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: item.name, options: ['Cancel', 'Delete deck'], destructiveButtonIndex: 1, cancelButtonIndex: 0 },
      (i) => {
        if (i === 1) {
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
                <View style={[styles.emojiBadge, { backgroundColor: item.color + '22' }]}>
                  <ThemedText style={styles.emoji}>{item.emoji}</ThemedText>
                </View>
                <View style={styles.deckInfo}>
                  <ThemedText style={styles.deckName}>{item.name}</ThemedText>
                  <ThemedText style={[styles.deckMeta, { color: colors.textSecondary }]}>
                    {item.due > 0 ? `${item.due} due · ` : ''}
                    {item.total} {item.total === 1 ? 'card' : 'cards'}
                  </ThemedText>
                </View>
                {item.due > 0 && (
                  <View style={[styles.dueBadge, { backgroundColor: item.color }]}>
                    <ThemedText style={styles.dueBadgeText}>{item.due}</ThemedText>
                  </View>
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
  emojiBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 24 },
  deckInfo: { flex: 1, gap: 2 },
  deckName: { fontSize: 17, fontWeight: '600' },
  deckMeta: { fontSize: 13, lineHeight: 18 },
  dueBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dueBadgeText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
