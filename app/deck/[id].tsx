import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActionSheetIOS, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
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
import { DAILY_GOAL } from '@/lib/progress';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function DeckScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { id } = useLocalSearchParams<{ id: string }>();
  const deckId = Number(id);

  const [deck, setDeck] = useState(() => getDeck(deckId));
  const [cards, setCards] = useState<Card[]>(() => cardsInDeck(deckId).all());
  const [pickerOpen, setPickerOpen] = useState(false);

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
  const sessionCount = Math.min(dueCount, DAILY_GOAL); // a session studies at most 21

  function handleAddCard() {
    router.push({ pathname: '/new-card/[deckId]', params: { deckId: String(deckId) } });
  }

  function startStudy() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({ pathname: '/study/[deckId]', params: { deckId: String(deckId) } });
  }

  function openImport() {
    router.push({ pathname: '/import/[deckId]', params: { deckId: String(deckId) } });
  }

  // Hold a card → native action sheet with options (currently Excluir).
  function showCardMenu(card: Card) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheetIOS.showActionSheetWithOptions(
      { title: card.front, options: ['Cancelar', 'Excluir card'], destructiveButtonIndex: 1, cancelButtonIndex: 0 },
      (i) => {
        if (i === 1) {
          deleteCard(card.id);
          refresh();
        }
      }
    );
  }

  function statusFor(state: number, due: number): { label: string; color: string } {
    if (state === State.New) return { label: 'Novo', color: colors.tint };
    if (due <= now) return { label: 'Revisar', color: accent };
    return { label: 'Em dia', color: colors.textSecondary };
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
            {all.length} cards · {dueCount} para revisar
          </ThemedText>
        </View>

        {/* Primary CTA */}
        {dueCount > 0 ? (
          <Pressable
            onPress={startStudy}
            style={({ pressed }) => [styles.cta, { backgroundColor: colors.tint, opacity: pressed ? 0.85 : 1 }]}>
            <IconSymbol name="play.fill" size={20} color="#fff" />
            <ThemedText style={styles.ctaText}>
              Bora! {sessionCount} {sessionCount === 1 ? 'card' : 'cards'}
            </ThemedText>
          </Pressable>
        ) : (
          <View style={[styles.cta, styles.ctaDone]}>
            <ThemedText style={[styles.ctaText, { color: colors.textSecondary }]}>
              Tudo em dia 🎉
            </ThemedText>
          </View>
        )}

        <ThemedText style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          TODOS OS CARDS
        </ThemedText>

        <FlatList
          data={cards}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: colors.textSecondary }]}>
              Nenhum card ainda. Toque em ＋ para adicionar.
            </ThemedText>
          }
          renderItem={({ item }) => {
            const status = statusFor(item.state, item.due.getTime());
            return (
              <Animated.View layout={LinearTransition} exiting={FadeOut.duration(220)}>
                <SwipeToDelete onConfirm={() => { deleteCard(item.id); refresh(); }}>
                  <Pressable onLongPress={() => showCardMenu(item)} delayLongPress={350}>
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
              <ThemedText style={styles.modalTitle}>Escolha um ícone</ThemedText>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 54,
    borderRadius: 16,
  },
  ctaDone: { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(128,128,128,0.3)' },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
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
});
