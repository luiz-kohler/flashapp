import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActionSheetIOS, FlatList, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassSurface } from '@/components/glass-surface';
import { RichText } from '@/components/rich-text';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/theme';
import { SwipeToDelete } from '@/components/swipe-to-delete';
import { cardsInDeck, deleteCard, getDeck, type SessionLimit } from '@/db/queries';
import type { Card } from '@/db/schema';
import { State } from '@/lib/fsrs';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function DeckScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { id } = useLocalSearchParams<{ id: string }>();
  const deckId = Number(id);
  const { height: windowHeight } = useWindowDimensions();

  const [deck, setDeck] = useState(() => getDeck(deckId));
  const [cards, setCards] = useState<Card[]>(() => cardsInDeck(deckId).all());
  // Card selected for preview (single tap). Null = preview closed.
  const [previewCard, setPreviewCard] = useState<Card | null>(null);
  // Sort mode for the "All cards" list. 'recent' = newest first (default, like
  // Spotify's liked-songs list), 'oldest' = oldest first (tap the clock again
  // to flip direction), 'shuffle' = random order. shuffleSeed lets the user
  // re-shuffle by tapping the shuffle icon again.
  const [sortMode, setSortMode] = useState<'recent' | 'oldest' | 'shuffle'>('recent');
  const [shuffleSeed, setShuffleSeed] = useState(0);
  // Session-size cap chosen by the user. Default 20 — close to DAILY_GOAL (21)
  // but a rounder, friendlier number for the menu. The play button passes this
  // to the study screen, which builds the queue with due-first + fill.
  const [sessionLimit, setSessionLimit] = useState<SessionLimit>(20);

  // drizzle's useLiveQuery only reacts to its own FROM table, so we re-read
  // explicitly: on focus (e.g. returning from import) and after each mutation.
  const refresh = useCallback(() => {
    setDeck(getDeck(deckId));
    setCards(cardsInDeck(deckId).all());
  }, [deckId]);
  useFocusEffect(useCallback(() => refresh(), [refresh]));

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
    if (sortMode === 'oldest') {
      return [...cards].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
  // Tapping the clock toggles direction (newest-first ↔ oldest-first), like
  // most lists with a single sort axis. Coming from shuffle, default to the
  // newest-first direction first.
  function toggleRecent() {
    Haptics.selectionAsync();
    setSortMode((m) => (m === 'recent' ? 'oldest' : 'recent'));
  }

  function handleAddCard() {
    router.push({ pathname: '/new-card/[deckId]', params: { deckId: String(deckId) } });
  }

  function startStudy() {
    if (all.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // The study screen builds the queue with due-first + fill from non-due to
    // honor the chosen limit, so play always has something to show as long as
    // the deck has at least one card. The sort choice mirrors the list above.
    router.push({
      pathname: '/study/[deckId]',
      params: { deckId: String(deckId), sort: sortMode, limit: String(sessionLimit) },
    });
  }

  // Tap the size pill → native action sheet to pick how many cards the next
  // session should have. Same pattern as the card menu (ActionSheetIOS) so it
  // feels native and stays out of the layout. 'All' means uncapped.
  function pickSessionSize() {
    Haptics.selectionAsync();
    const options = ['Cancel', '5 cards', '10 cards', '15 cards', '20 cards', 'All cards'];
    const values: SessionLimit[] = [5, 10, 15, 20, 'all'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Session size', options, cancelButtonIndex: 0 },
      (i) => {
        if (i > 0 && i <= values.length) setSessionLimit(values[i - 1]);
      }
    );
  }

  const limitLabel = sessionLimit === 'all' ? 'All' : String(sessionLimit);

  function openImport() {
    router.push({ pathname: '/import/[deckId]', params: { deckId: String(deckId) } });
  }

  // Hold a card → native action sheet: edit (front/back) or delete. We push
  // the edit screen instead of using Alert.prompt because card content can be
  // multi-line / rich, and Alert.prompt is single-line only.
  function showCardMenu(card: Card) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: card.front,
        options: ['Cancel', 'Edit card', 'Delete card'],
        destructiveButtonIndex: 2,
        cancelButtonIndex: 0,
      },
      (i) => {
        if (i === 1) {
          router.push({ pathname: '/edit-card/[id]', params: { id: String(card.id) } });
        } else if (i === 2) {
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

        {/* Compact hero row — title+subtitle | play. Apple Music / Spotify
            compact style: horizontal instead of stacked, so the list of cards
            starts higher on the screen. The deck emoji is intentionally not
            shown here (it lives on the decks list); this page is focused on
            the cards themselves. */}
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <ThemedText style={styles.title} numberOfLines={1}>{deck?.name ?? 'Deck'}</ThemedText>
            <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={1}>
              {all.length} cards · {dueCount} due
            </ThemedText>
          </View>
          {/* Session-size pill: tap to pick 5/10/15/20/All cards. Sits to the
              left of play so the eye reads "[how much] ▶ [go]". Glass pill,
              chevron-down hints it's a menu. */}
          <Pressable onPress={pickSessionSize} hitSlop={10}>
            <GlassSurface radius={14} style={styles.sizePill}>
              <ThemedText style={[styles.sizePillText, { color: colors.text }]}>
                {limitLabel}
              </ThemedText>
              <IconSymbol name="chevron.down" size={11} color={colors.textSecondary} />
            </GlassSurface>
          </Pressable>
          {/* Primary CTA — round icon-only play button, Spotify style. Always
              visible: the study screen fills the session with due-first cards
              then non-due up to the chosen limit, so play always has cards. */}
          <Pressable
            onPress={startStudy}
            hitSlop={12}
            style={({ pressed }) => [styles.cta, { backgroundColor: accent, opacity: pressed ? 0.85 : 1 }]}>
            <IconSymbol name="play.fill" size={20} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <ThemedText style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            ALL CARDS
          </ThemedText>
          {/* Sort: icon-only, Spotify style (the active one lights up in the
              accent color). The clock toggles direction — in 'oldest' mode we
              mirror the icon horizontally so the curved arrow points the
              other way, signaling "going forward in time" instead of back. */}
          <View style={styles.sortRow}>
            <Pressable onPress={toggleRecent} hitSlop={10} style={styles.sortBtn}>
              <IconSymbol
                name="clock.arrow.circlepath"
                size={18}
                color={sortMode === 'recent' || sortMode === 'oldest' ? accent : colors.textSecondary}
                style={sortMode === 'oldest' ? styles.sortIconFlipped : undefined}
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

        {/* Card preview (single tap on a row). Shows the full front and back
            without touching FSRS scheduling — read-only. Tap the dim overlay
            (outside the card) to close. We don't close on a tap inside the
            card so the user can read it without dismissing by accident. */}
        <Modal
          visible={previewCard !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewCard(null)}>
          <Pressable style={styles.previewOverlay} onPress={() => setPreviewCard(null)}>
            {previewCard && (
              // Pixel-based maxHeight via useWindowDimensions: RN percentage
              // heights don't resolve when the parent has no explicit height,
              // which was collapsing the inner ScrollView and hiding the back.
              <View
                style={[styles.previewCardWrap, { maxHeight: windowHeight * 0.8 }]}
                onStartShouldSetResponder={() => true}>
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
                      style={[styles.previewBack, { color: colors.text }]}
                    />
                  </ScrollView>
                </GlassSurface>
              </View>
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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  heroText: { flex: 1, gap: 2, minWidth: 0 },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 28 },
  subtitle: { fontSize: 13 },
  cta: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    // Subtle shadow to give the Spotify-style play button its pop.
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sizePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
  },
  sizePillText: { fontSize: 14, fontWeight: '700' },
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
  sortIconFlipped: { transform: [{ scaleX: -1 }] },
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
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
  previewCardWrap: { width: '100%', maxWidth: 520 },
  // flexShrink lets the surface shrink to its wrap's bounded maxHeight when
  // content is tall, so the ScrollView inside gets a real bounded height and
  // actually scrolls instead of clipping the back text.
  previewCard: { flexShrink: 1, padding: Spacing.four },
  previewContent: { gap: Spacing.three },
  previewFront: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  previewDivider: { height: StyleSheet.hairlineWidth },
  previewBack: { fontSize: 18, lineHeight: 26 },
});
