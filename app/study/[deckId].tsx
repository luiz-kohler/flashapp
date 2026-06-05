import { BlurView } from 'expo-blur';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RichText } from '@/components/rich-text';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/theme';
import { getAllCardsForPractice, getDeck, getReviewsToday, getStudyQueue, recordReview, type StudyOrder } from '@/db/queries';
import type { Card } from '@/db/schema';
import { Rating, type ReviewGrade } from '@/lib/fsrs';
import { DAILY_GOAL, xpForRating } from '@/lib/progress';

// Only two ratings are surfaced in the UI: thumbs-down maps to Again (re-queues
// the card and counts as a miss) and thumbs-up to Good (the standard correct
// answer in FSRS). Hard and Easy still exist in the engine but aren't exposed
// — the simplified interaction mirrors iOS-style "like / don't like" controls.
const THUMBS_DOWN_RGB = '255,69,58';
const THUMBS_UP_RGB = '50,215,75';
const THUMBS_DOWN_COLOR = '#FF453A';
const THUMBS_UP_COLOR = '#32D74B';

function RatingButton({
  rgb,
  color,
  icon,
  onPress,
}: {
  rgb: string;
  color: string;
  icon: 'hand.thumbsup.fill' | 'hand.thumbsdown.fill';
  onPress: () => void;
}) {
  // Two animated layers per button:
  //   - `scale` drives the press-down/spring-back of the button itself
  //   - `haloScale`/`haloOpacity` drive a one-shot ring that expands and fades
  //     outward when the user taps, giving the iOS-style "ripple" feedback.
  const scale = useRef(new Animated.Value(1)).current;
  const haloScale = useRef(new Animated.Value(0.8)).current;
  const haloOpacity = useRef(new Animated.Value(0)).current;

  function handlePressIn() {
    Animated.spring(scale, {
      toValue: 0.9,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
  }

  function handlePressOut() {
    // Tension/friction tuned to overshoot 1.0 slightly — feels alive, not stiff.
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 3,
      tension: 200,
    }).start();
  }

  function handlePress() {
    haloScale.setValue(0.85);
    haloOpacity.setValue(0.55);
    Animated.parallel([
      Animated.timing(haloScale, { toValue: 1.55, duration: 380, useNativeDriver: true }),
      Animated.timing(haloOpacity, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]).start();
    // Short delay so the press animation is visible before the next card replaces
    // these buttons. 130ms is long enough to register the bounce, short enough
    // to still feel snappy during rapid review sessions.
    setTimeout(onPress, 130);
  }

  return (
    <Pressable
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      hitSlop={12}
      style={styles.ratingWrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ratingHalo,
          {
            backgroundColor: `rgba(${rgb},1)`,
            opacity: haloOpacity,
            transform: [{ scale: haloScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.ratingBtn,
          {
            backgroundColor: `rgba(${rgb},0.22)`,
            borderColor: `rgba(${rgb},0.55)`,
            transform: [{ scale }],
          },
        ]}>
        <IconSymbol name={icon} size={38} color={color} />
      </Animated.View>
    </Pressable>
  );
}

export default function StudyScreen() {
  const { deckId, practice, sort } = useLocalSearchParams<{ deckId: string; practice?: string; sort?: string }>();
  const did = Number(deckId);
  const isPractice = practice === '1';
  // Order chosen on the deck screen (shuffle/recent). Falls back to shuffle —
  // the historical default — for any unknown value so old links keep working.
  const order: StudyOrder = sort === 'recent' ? 'recent' : 'shuffle';
  const deck = useMemo(() => getDeck(did), [did]);
  const accent = deck?.color ?? Colors.light.tint;

  const [queue, setQueue] = useState<Card[]>(() =>
    isPractice ? getAllCardsForPractice(did, order) : getStudyQueue(did, order)
  );
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [baseToday] = useState(() => getReviewsToday());
  const [sessionXp, setSessionXp] = useState(0);
  const reveal = useRef(new Animated.Value(0)).current;

  const sReveal = useAudioPlayer(require('@/assets/sounds/reveal.wav'));
  const sAgain = useAudioPlayer(require('@/assets/sounds/again.wav'));
  const sGood = useAudioPlayer(require('@/assets/sounds/good.wav'));
  const soundByGrade: Record<number, ReturnType<typeof useAudioPlayer>> = {
    [Rating.Again]: sAgain,
    [Rating.Good]: sGood,
  };
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);
  function playSound(p: ReturnType<typeof useAudioPlayer>) {
    try {
      p.seekTo(0);
      p.play();
    } catch {
      // sound is non-essential feedback
    }
  }

  const current = queue[pos];
  const done = !current;
  const goalToday = baseToday + reviewed;
  const goalMet = goalToday >= DAILY_GOAL;
  const accuracy = reviewed > 0 ? Math.round((correct / reviewed) * 100) : 0;

  function showAnswer() {
    Haptics.selectionAsync();
    playSound(sReveal);
    setRevealed(true);
    Animated.timing(reveal, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  function rate(grade: ReviewGrade) {
    if (!current) return;
    const wasUnderGoal = goalToday < DAILY_GOAL;
    Haptics.impactAsync(
      grade === Rating.Again ? Haptics.ImpactFeedbackStyle.Rigid : Haptics.ImpactFeedbackStyle.Light
    );
    playSound(soundByGrade[grade]);
    setSessionXp((n) => n + xpForRating(grade));
    const outcome = recordReview(current, grade);
    if (grade === Rating.Again) {
      setQueue((q) => [...q, { ...current, ...outcome.card } as Card]);
    }
    if (grade === Rating.Good || grade === Rating.Easy) setCorrect((n) => n + 1);
    if (wasUnderGoal && goalToday + 1 >= DAILY_GOAL) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setReviewed((n) => n + 1);
    reveal.setValue(0);
    setRevealed(false);
    setPos((p) => p + 1);
  }

  return (
    <View style={styles.root}>
      {/* Same dark background used across the rest of the app. */}
      <LinearGradient colors={['#101114', '#000000']} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <BlurView tint="systemThickMaterialDark" intensity={40} style={styles.closeBtn}>
              <IconSymbol name="chevron.left" size={22} color="#fff" />
            </BlurView>
          </Pressable>
          <View style={styles.flex1} />
          <View style={[styles.goalPill, goalMet && styles.goalPillMet]}>
            <ThemedText style={styles.goalText}>
              {Math.min(goalToday, DAILY_GOAL)}/{DAILY_GOAL}
            </ThemedText>
          </View>
        </View>

        {done ? (
          <View style={styles.doneWrap}>
            <IconSymbol name="checkmark.circle.fill" size={72} color="#30D158" />
            <ThemedText style={styles.doneTitle}>Session complete</ThemedText>
            <ThemedText style={styles.doneSub}>
              {reviewed} {reviewed === 1 ? 'card reviewed' : 'cards reviewed'}
              {reviewed > 0 ? ` · ${accuracy}% correct` : ''}
            </ThemedText>
            {sessionXp > 0 && <ThemedText style={styles.doneXp}>+{sessionXp} XP</ThemedText>}
            {goalMet && <ThemedText style={styles.doneGoal}>Daily goal hit!</ThemedText>}
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.doneBtn, { opacity: pressed ? 0.8 : 1 }]}>
              <ThemedText style={styles.doneBtnText}>Back</ThemedText>
            </Pressable>
          </View>
        ) : (
          <View style={styles.center}>
            {/* Glass card */}
            <BlurView tint="systemThickMaterialDark" intensity={55} style={styles.card}>
              <ThemedText style={[styles.faceLabel, { color: accent }]}>FRONT</ThemedText>
              <RichText text={current.front} style={styles.front} />
              {revealed && (
                <Animated.View
                  style={[
                    styles.answerWrap,
                    {
                      opacity: reveal,
                      transform: [
                        { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                      ],
                    },
                  ]}>
                  <View style={styles.divider} />
                  <ThemedText style={[styles.faceLabel, { color: accent }]}>BACK</ThemedText>
                  <RichText text={current.back} style={styles.back} />
                </Animated.View>
              )}
            </BlurView>

            <ThemedText style={styles.stats}>
              Cards: {reviewed} · Correct: {reviewed > 0 ? `${accuracy}%` : '—'}
            </ThemedText>

            {!revealed ? (
              <Pressable onPress={showAnswer} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                <BlurView tint="systemThickMaterialDark" intensity={40} style={styles.revealBtn}>
                  <ThemedText style={styles.revealText}>Show answer</ThemedText>
                </BlurView>
              </Pressable>
            ) : (
              <View style={styles.ratings}>
                <RatingButton
                  rgb={THUMBS_DOWN_RGB}
                  color={THUMBS_DOWN_COLOR}
                  icon="hand.thumbsdown.fill"
                  onPress={() => rate(Rating.Again)}
                />
                <RatingButton
                  rgb={THUMBS_UP_RGB}
                  color={THUMBS_UP_COLOR}
                  icon="hand.thumbsup.fill"
                  onPress={() => rate(Rating.Good)}
                />
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  safe: { flex: 1, paddingHorizontal: Spacing.three },
  flex1: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingTop: Spacing.one },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalPill: {
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  goalPillMet: { backgroundColor: 'rgba(255,214,10,0.3)' },
  goalText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  center: { flex: 1, justifyContent: 'center', gap: Spacing.three },

  card: {
    borderRadius: 28,
    overflow: 'hidden',
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    minHeight: 240,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  faceLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.5, marginBottom: Spacing.two },
  front: { fontSize: 26, fontWeight: '700', color: '#fff', textAlign: 'center', lineHeight: 32 },
  answerWrap: { alignSelf: 'stretch', alignItems: 'center', marginTop: Spacing.three },
  divider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginBottom: Spacing.three,
  },
  back: { fontSize: 20, color: 'rgba(255,255,255,0.92)', textAlign: 'center', lineHeight: 28 },
  stats: { textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '600' },

  revealBtn: {
    height: 56,
    borderRadius: 18,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  revealText: { fontSize: 17, fontWeight: '700', color: '#fff' },

  ratings: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.five,
    paddingVertical: Spacing.two,
  },
  ratingWrap: {
    width: 88,
    height: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ratingBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  ratingHalo: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
  },

  doneWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
  doneTitle: { color: '#fff', fontSize: 26, fontWeight: '700', marginTop: Spacing.two },
  doneSub: { color: 'rgba(255,255,255,0.85)', fontSize: 16, textAlign: 'center' },
  doneGoal: { color: Colors.dark.tint, fontSize: 16, fontWeight: '700', marginTop: Spacing.one },
  doneXp: { color: Colors.dark.tint, fontSize: 20, fontWeight: '800', marginTop: Spacing.one },
  doneBtn: {
    marginTop: Spacing.four,
    backgroundColor: '#fff',
    paddingHorizontal: Spacing.five,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { fontSize: 17, fontWeight: '700', color: '#11181C' },
});
