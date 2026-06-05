import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassSurface } from '@/components/glass-surface';
import { RichText } from '@/components/rich-text';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/theme';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { cardsInDeck, deleteCard, getDeck, updateDeck } from '@/db/queries';
import type { Card } from '@/db/schema';
import { EMOJIS } from '@/lib/emojis';
import { State } from '@/lib/fsrs';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function DeckScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { id } = useLocalSearchParams<{ id: string }>();
  const deckId = Number(id);

  const [deck, setDeck] = useState(() => getDeck(deckId));
  const [cards, setCards] = useState<Card[]>(() => cardsInDeck(deckId).all());
  const [pickerOpen, setPickerOpen] = useState(false);
  // Card selected for preview (single tap). Null = preview closed.
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  // Sort mode for the "All cards" list. 'recent' = newest first (default, like
  // Spotify's liked-songs list), 'shuffle' = random order. shuffleSeed lets the
  // user re-shuffle by tapping the shuffle icon again.
  const [sortMode, setSortMode] = useState<'recent' | 'shuffle'>('recent');
  const [shuffleSeed, setShuffleSeed] = useState(0);

  // drizzle's useLiveQuery only reacts to its own FROM table, so we re-read
  // explicitly: on focus (e.g. returning from import) and after each mutation.
  const refresh = useCallback(() => {
    setDeck(getDeck(deckId));
    setCards(cardsInDeck(deckId).all());
  }, [deckId]);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

  function pickEmoji(e: string) {
    updateDeck(deckId, { emoji: e });
    Haptics.selectionAsync();
    setPickerOpen(false);
    refresh();
  }

  const accent = deck?.color ?? colors.tint;
  const now = Date.now();
  const all = cards;
  const dueCount = all.filter((c) => c.due.getTime() <= now).length;

  // Sort the visible list according to sortMode. In 'shuffle' we use a
  // Fisher–Yates seeded by shuffleSeed so the order stays stable between
  // re-renders (until the user taps the icon again, which changes the seed).
  const sortedCards = useMemo(() => {
    if (sortMode === 'recent') {
      return [...cards].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
    const arr = [...cards];
    let s = shuffleSeed || 1;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }, [cards, sortMode, shuffleSeed]);

  function toggleShuffle() {
    Haptics.selectionAsync();
    if (sortMode === 'shuffle') {
      setShuffleSeed((s) => s + 1); // already shuffled: re-shuffle
    } else {
      setSortMode('shuffle');
      setShuffleSeed(Date.now());
    }
  }
  function pickRecent() {
    Haptics.selectionAsync();
    setSortMode('recent');
  }

  function handleAddCard() {
    router.push({ pathname: '/new-card/[deckId]', params: { deckId: String(deckId) } });
  }

  function startStudy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // No due cards → fall back to practice mode (review all without affecting FSRS),
    // so the play button always works, like Spotify's play.
    const practice = dueCount === 0 && all.length > 0 ? '1' : undefined;
    router.push({ pathname: '/study/[deckId]', params: { deckId: String(deckId), practice } });
  }

  function openImport() {
    router.push({ pathname: '/import/[deckId]', params: { deckId: String(deckId) } });
  }

  // Hold a card → native action sheet with options (currently Delete).
  function showCardMenu(card: Card) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: card.front, options: ['Cancel', 'Delete card'], destructiveButtonIndex: 1, cancelButtonIndex: 0 },
      (i) => {
        if (i === 1) {
          deleteCard(card.id);
          refresh();
        }
      }
    );
  }

  function statusFor(state: number, due: number): { label: string; color: string } {
    if (state === State.New) return { label: 'New', color: colors.tint };
    if (due <= now) return { label: 'Due', color: accent };
    return { label: 'Learned', color: colors.textSecondary };
  }

  const bg: [string, string] =
    scheme === 'dark' ? ['#101114', '#000000'] : [accent + '14', '#F7F8FC'];

  return (
    <View style={styles.root}>
      <LinearGradient colors={bg} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <GlassSurface radius={18} style={styles.iconButton}>
              <IconSymbol name="chevron.left" size={22} color={colors.text} />
            </GlassSurface>
          </Pressable>
          <View style={styles.headerRight}>
            {/* Discrete: bulk-import cards from pasted/AI text */}
            <Pressable onPress={openImport} hitSlop={12}>
              <GlassSurface radius={18} style={styles.iconButton}>
                <IconSymbol name="sparkles" size={20} color={colors.tint} />
              </GlassSurface>
            </Pressable>
            <Pressable onPress={handleAddCard} hitSlop={12}>
              <GlassSurface radius={18} style={styles.iconButton}>
                <IconSymbol name="plus" size={22} color={colors.tint} />
              </GlassSurface>
            </Pressable>
          </View>
        </View>

        <View style={styles.titleBlock}>
          <Pressable onPress={() => setPickerOpen(true)} hitSlop={8}>
            <ThemedText style={styles.deckEmoji}>{deck?.emoji ?? '📚'}</ThemedText>
          </Pressable>
          <ThemedText style={styles.title}>{deck?.name ?? 'Deck'}</ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
            {all.length} cards · {dueCount} due
          </ThemedText>
        </View>

        {/* Primary CTA — round icon-only play button, Spotify style. Always
            visible: with due cards it starts a normal session; with none,
            startStudy() falls back to practice mode. */}
        <Pressable
          onPress={startStudy}
          hitSlop={12}
          style={({ pressed }) => [styles.cta, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}>
          <IconSymbol name="play.fill" size={24} color="#fff" />
        </Pressable>

        <View style={styles.sectionHeader}>
          <ThemedText style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            ALL CARDS
          </ThemedText>
          {/* Sort: icon-only, Spotify style (the active one lights up in the accent color). */}
          <View style={styles.sortRow}>
            <Pressable onPress={pickRecent} hitSlop={10} style={styles.sortBtn}>
              <IconSymbol
                name="clock.arrow.circlepath"
                size={18}
                color={sortMode === 'recent' ? accent : colors.textSecondary}
              />
            </Pressable>
            <Pressable onPress={toggleShuffle} hitSlop={10} style={styles.sortBtn}>
              <IconSymbol
                name="shuffle"
                size={18}
                color={sortMode === 'shuffle' ? accent : colors.textSecondary}
              />
            </Pressable>
          </View>
        </View>

        <FlatList
          data={sortedCards}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: colors.textSecondary }]}>
              No cards yet. Tap ＋ to add one.
            </ThemedText>
          }
          renderItem={({ item }) => {
            const status = statusFor(item.state, item.due.getTime());
            return (
              <Animated.View layout={LinearTransition} exiting={FadeOut.duration(220)}>
                <SwipeToDelete onConfirm={() => { deleteCard(item.id); refresh(); }}>
                  <Pressable
                    onPress={() => { Haptics.selectionAsync(); setPreviewCard(item); }}
                    onLongPress={() => showCardMenu(item)}
                    delayLongPress={350}>
                  <GlassSurface radius={16} style={styles.cardRow}>
                <View style={styles.cardText}>
                  <RichText
                    text={item.front}
                    style={[styles.cardFront, { color: colors.text }]}
                    numberOfLines={1}
                  />
                  <RichText
                    text={item.back}
                    style={[styles.cardBack, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  />
                </View>
                <View style={[styles.pill, { backgroundColor: status.color + '22' }]}>
                  <ThemedText style={[styles.pillText, { color: status.color }]}>
                    {status.label}
                  </ThemedText>
                </View>
                </GlassSurface>
                  </Pressable>
                </SwipeToDelete>
              </Animated.View>
            );
          }}
        />

        <Modal
          visible={pickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerOpen(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setPickerOpen(false)}>
            <View style={[styles.modalSheet, { backgroundColor: colors.surface }]}>
              <ThemedText style={styles.modalTitle}>Choose an icon</ThemedText>
              <View style={styles.emojiGrid}>
                {EMOJIS.map((e) => (
                  <Pressable key={e} onPress={() => pickEmoji(e)} style={styles.emojiCell}>
                    <ThemedText style={styles.emojiOption}>{e}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </View>
          </Pressable>
        </Modal>

        {/* Card preview (single tap on a row). Shows the full front and back
            without touching FSRS scheduling — read-only. Tapping anywhere
            outside or on the card itself closes it. */}
        <Modal
          visible={previewCard !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewCard(null)}>
          <Pressable style={styles.previewOverlay} onPress={() => setPreviewCard(null)}>
            {previewCard && (
              <Pressable onPress={() => setPreviewCard(null)} style={styles.previewCardWrap}>
                <GlassSurface radius={20} style={styles.previewCard}>
                  <ScrollView
                    contentContainerStyle={styles.previewContent}
                    showsVerticalScrollIndicator={false}>
                    <RichText
                      text={previewCard.front}
                      style={[styles.previewFront, { color: colors.text }]}
                    />
                    <View style={[styles.previewDivider, { backgroundColor: colors.textSecondary + '33' }]} />
                    <RichText
                      text={previewCard.back}
                      style={[styles.previewBack, { color: colors.textSecondary }]}
                    />
                  </ScrollView>
                </GlassSurface>
              </Pressable>
            )}
          </Pressable>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // Wider side padding keeps cards off the screen edge, so the iOS back swipe
  // (edge gesture) doesn't land on a row and accidentally trigger delete.
  safe: { flex: 1, paddingHorizontal: Spacing.four },
  header: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: Spacing.one },
  headerRight: { flexDirection: 'row', gap: Spacing.two },
  iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { paddingTop: Spacing.three, paddingBottom: Spacing.four, gap: Spacing.one },
  deckEmoji: { fontSize: 44, lineHeight: 54 },
  title: { fontSize: 30, fontWeight: '700', lineHeight: 36 },
  subtitle: { fontSize: 14 },
  cta: {
    alignSelf: 'flex-start',
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow to give the Spotify-style play button its pop.
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  sortRow: { flexDirection: 'row', gap: Spacing.two },
  sortBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.two, paddingBottom: 120 },
  empty: { textAlign: 'center', marginTop: Spacing.five, fontSize: 15 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  cardText: { flex: 1, gap: 3 },
  cardFront: { fontSize: 16, fontWeight: '600' },
  cardBack: { fontSize: 14 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  pillText: { fontSize: 11, fontWeight: '700' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  emojiCell: { width: '12.5%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiOption: { fontSize: 28, lineHeight: 36 },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  previewCardWrap: { width: '100%', maxWidth: 520 },
  previewCard: { maxHeight: '80%', padding: Spacing.four },
  previewContent: { gap: Spacing.three },
  previewFront: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  previewDivider: { height: StyleSheet.hairlineWidth },
  previewBack: { fontSize: 18, lineHeight: 26 },
});
