import { BlurView } from 'expo-blur';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
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
// iOS system reds/greens (UIColor.systemRed / .systemGreen, light variant).
const THUMBS_DOWN_COLOR = '#FF3B30';
const THUMBS_UP_COLOR = '#34C759';

function RatingButton({
  bg,
  icon,
  onPress,
}: {
  bg: string;
  icon: 'hand.thumbsup.fill' | 'hand.thumbsdown.fill';
  onPress: () => void;
}) {
  // RN port of Framer Motion's whileTap={{ scale: 0.95 }} with
  // spring(stiffness: 400, damping: 17, mass: 1). That damping ratio is the
  // physics equivalent of cubic-bezier(0.34, 1.56, 0.64, 1): the scale
  // overshoots ~1.02 on release before settling. Animated.spring runs this on
  // the native side when useNativeDriver is true.
  const scale = useRef(new Animated.Value(1)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    // Respect the iOS system "Reduce Motion" toggle (Settings → Accessibility).
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotion.current = v;
    });
  }, []);

  function springTo(toValue: number) {
    if (reduceMotion.current) {
      scale.setValue(toValue);
      return;
    }
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      stiffness: 400,
      damping: 17,
      mass: 1,
    }).start();
  }

  return (
    <Pressable
      onPressIn={() => springTo(0.95)}
      onPressOut={() => springTo(1)}
      onHoverIn={() => springTo(1.03)}
      onHoverOut={() => springTo(1)}
      onPress={onPress}
      hitSlop={12}
      style={styles.ratingWrap}>
      <Animated.View
        style={[
          styles.ratingShadow,
          { shadowColor: bg, transform: [{ scale }] },
        ]}>
        <View style={[styles.ratingBtn, { backgroundColor: bg }]}>
          {/* Soft top sheen — convex highlight that fades into the button color. */}
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.28)', 'rgba(255,255,255,0)']}
            style={styles.ratingHighlight}
          />
          <IconSymbol name={icon} size={30} color="#fff" />
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function StudyScreen() {
  const { deckId, practice, sort } = useLocalSearchParams<{ deckId: string; practice?: string; sort?: string }>();
  const did = Number(deckId);
  const isPractice = practice === '1';
  // Order chosen on the deck screen (shuffle/recent/oldest). Falls back to
  // shuffle — the historical default — for any unknown value so old links keep
  // working.
  const order: StudyOrder =
    sort === 'recent' ? 'recent' : sort === 'oldest' ? 'oldest' : 'shuffle';
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
                  bg={THUMBS_DOWN_COLOR}
                  icon="hand.thumbsdown.fill"
                  onPress={() => rate(Rating.Again)}
                />
                <RatingButton
                  bg={THUMBS_UP_COLOR}
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
    alignItems: 'stretch',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  ratingWrap: {
    flex: 1,
    maxWidth: 180,
  },
  // Outer view carries the iOS drop shadow tinted to the button color.
  // overflow:hidden lives on the inner view so the shadow isn't clipped.
  ratingShadow: {
    borderRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  ratingBtn: {
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    elevation: 8,
  },
  ratingHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '55%',
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
