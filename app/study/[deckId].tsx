import { BlurView } from 'expo-blur';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type EasingFunction,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RichText } from '@/components/rich-text';
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/theme';
import { getDeck, getReviewsToday, getStudySession, recordReview, type SessionLimit, type StudyOrder } from '@/db/queries';
import type { Card } from '@/db/schema';
import { Rating, type ReviewGrade } from '@/lib/fsrs';
import { DAILY_GOAL, xpForRating } from '@/lib/progress';

// Only two ratings are surfaced: the X button maps to Again (re-queues the card
// and counts as a miss) and the check to Good. Hard and Easy still exist in the
// FSRS engine but aren't exposed — the simplified interaction is "wrong / right".
// iOS system reds/greens (UIColor.systemRed / .systemGreen, light variant).
const WRONG_COLOR = '#FF3B30';
const CORRECT_COLOR = '#34C759';

// Off-screen distance for the swipe-out animation. Width + a margin so the
// card fully leaves the viewport before opacity reaches zero.
const SCREEN_WIDTH = Dimensions.get('window').width;
const EXIT_DISTANCE = SCREEN_WIDTH + 80;

// Idle pose of the card peeking out behind the current card. Slightly smaller
// + nudged down so its top edge is visible above the front card.
const BACK_SCALE = 0.94;
const BACK_TRANSLATE_Y = 12;
const BACK_OPACITY = 0.55;

// Apple-ish "ease out" curve (cubic-bezier(0.22, 1, 0.36, 1) ≈ easeOutQuart).
// Starts moving fast then settles gently — the entrance of the next card and
// the fade-in of the bottom action area both use it so the motion reads as a
// single coordinated gesture instead of two independent timing curves.
const ENTRANCE_EASING: EasingFunction = Easing.bezier(0.22, 1, 0.36, 1);

function RatingButton({
  color,
  icon,
  onPress,
  disabled,
}: {
  color: string;
  icon: 'checkmark' | 'xmark';
  onPress: () => void;
  disabled?: boolean;
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
      onPressIn={() => !disabled && springTo(0.95)}
      onPressOut={() => !disabled && springTo(1)}
      onHoverIn={() => !disabled && springTo(1.03)}
      onHoverOut={() => !disabled && springTo(1)}
      onPress={() => !disabled && onPress()}
      hitSlop={12}
      style={[styles.ratingWrap, disabled && styles.ratingDisabled]}>
      <Animated.View style={{ transform: [{ scale }] }}>
        {/* Glass surface tinted with the intent color — same blur material
            as the reveal button, just with a low-alpha color overlay and a
            stronger colored border so the meaning still reads at a glance. */}
        <BlurView
          tint="systemThickMaterialDark"
          intensity={40}
          style={[
            styles.ratingBtn,
            { backgroundColor: color + '26', borderColor: color + 'B3' },
          ]}>
          <IconSymbol name={icon} size={26} color={color} weight="bold" />
        </BlurView>
      </Animated.View>
    </Pressable>
  );
}

export default function StudyScreen() {
  const { deckId, sort, limit } = useLocalSearchParams<{ deckId: string; sort?: string; limit?: string }>();
  const did = Number(deckId);
  // Order chosen on the deck screen (shuffle/recent/oldest). Falls back to
  // shuffle — the historical default — for any unknown value so old links keep
  // working.
  const order: StudyOrder =
    sort === 'recent' ? 'recent' : sort === 'oldest' ? 'oldest' : 'shuffle';
  // Session size cap from the deck screen. 'all' uncaps; numeric caps the set
  // (due-first, filled from non-due). Default 20 mirrors the deck screen.
  const parsedLimit: SessionLimit =
    limit === 'all' ? 'all' : Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 20;
  const deck = useMemo(() => getDeck(did), [did]);
  const accent = deck?.color ?? Colors.light.tint;

  const [queue, setQueue] = useState<Card[]>(() => getStudySession(did, order, parsedLimit));
  const [pos, setPos] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [baseToday] = useState(() => getReviewsToday());
  const [sessionXp, setSessionXp] = useState(0);
  const reveal = useRef(new Animated.Value(0)).current;

  // Front-card exit + back-card promote animations. Driving values:
  //   cardX  — horizontal slide of the current card (0 → ±EXIT_DISTANCE)
  //   cardSwipe — direction signal in [-1, 1], interpolated to a tilt
  //   cardOpacity — fade-out of the exiting card
  //   nextScale / nextTranslateY / nextOpacity — back card rising to the front
  // All run together so the next card "catches" the position the front leaves.
  const cardX = useRef(new Animated.Value(0)).current;
  const cardSwipe = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const nextScale = useRef(new Animated.Value(BACK_SCALE)).current;
  const nextTranslateY = useRef(new Animated.Value(BACK_TRANSLATE_Y)).current;
  const nextOpacity = useRef(new Animated.Value(BACK_OPACITY)).current;
  // Opacity of the bottom action area (Show answer / X · ✓ buttons). Fades
  // out during the swipe-out and back in once the new card is in place, so
  // the button swap doesn't "pop" — it crossfades with the card transition.
  const bottomOpacity = useRef(new Animated.Value(1)).current;
  // Guards against double-taps while the exit animation is still running.
  const animating = useRef(false);

  function resetStackAnim() {
    cardX.setValue(0);
    cardSwipe.setValue(0);
    cardOpacity.setValue(1);
    nextScale.setValue(BACK_SCALE);
    nextTranslateY.setValue(BACK_TRANSLATE_Y);
    nextOpacity.setValue(BACK_OPACITY);
  }

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
  // Session progress for the top pill. `queue.length` grows when an Again
  // rating re-queues a card, so the denominator honestly reflects "cards left
  // in this session" rather than the static daily goal. `pos` advances after
  // each rate, so `pos + 1` is the 1-indexed position of the card on screen;
  // capped at the total so the done state shows e.g. "10/10".
  const sessionTotal = queue.length;
  const sessionPos = done ? sessionTotal : Math.min(pos + 1, sessionTotal);
  const sessionComplete = done && sessionTotal > 0;

  function showAnswer() {
    Haptics.selectionAsync();
    playSound(sReveal);
    setRevealed(true);
    Animated.timing(reveal, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  function rate(grade: ReviewGrade) {
    if (!current || animating.current) return;
    animating.current = true;
    const wasUnderGoal = goalToday < DAILY_GOAL;
    Haptics.impactAsync(
      grade === Rating.Again ? Haptics.ImpactFeedbackStyle.Rigid : Haptics.ImpactFeedbackStyle.Light
    );
    playSound(soundByGrade[grade]);
    setSessionXp((n) => n + xpForRating(grade));
    const outcome = recordReview(current, grade);
    if (grade === Rating.Good || grade === Rating.Easy) setCorrect((n) => n + 1);
    if (wasUnderGoal && goalToday + 1 >= DAILY_GOAL) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setReviewed((n) => n + 1);

    // Wrong → swipe left, correct → swipe right. easeOutCubic on the exit
    // gives the snappy "card flicked off the deck" feel. The next-card
    // entrance uses a softer easeOutQuart and starts ~70ms later, so the
    // front card visibly clears the area before the back card rises into
    // focus — the two motions read as a sequence, not a simultaneous lurch.
    const direction = grade === Rating.Again ? -1 : 1;
    const exitEasing = Easing.out(Easing.cubic);
    Animated.parallel([
      Animated.timing(cardX, {
        toValue: direction * EXIT_DISTANCE,
        duration: 320,
        easing: exitEasing,
        useNativeDriver: true,
      }),
      Animated.timing(cardSwipe, {
        toValue: direction,
        duration: 320,
        easing: exitEasing,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      // Fade the bottom action area out while the front card exits, so the
      // rating buttons don't disappear with a hard cut when state resets.
      Animated.timing(bottomOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(70),
        Animated.parallel([
          Animated.timing(nextScale, {
            toValue: 1,
            duration: 320,
            easing: ENTRANCE_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(nextTranslateY, {
            toValue: 0,
            duration: 320,
            easing: ENTRANCE_EASING,
            useNativeDriver: true,
          }),
          Animated.timing(nextOpacity, {
            toValue: 1,
            duration: 320,
            easing: ENTRANCE_EASING,
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start(() => {
      // Apply all state changes synchronously, then reset the anim values to
      // their idle pose. Because the back card was promoted to the front pose
      // and is the same card that will now render as `current`, there's no
      // visible snap.
      if (grade === Rating.Again) {
        setQueue((q) => [...q, { ...current, ...outcome.card } as Card]);
      }
      reveal.setValue(0);
      setRevealed(false);
      setPos((p) => p + 1);
      resetStackAnim();
      // Fade the new "Show answer" button in gently instead of popping it in.
      Animated.timing(bottomOpacity, {
        toValue: 1,
        duration: 240,
        easing: ENTRANCE_EASING,
        useNativeDriver: true,
      }).start();
      animating.current = false;
    });
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
          {sessionTotal > 0 && (
            <View style={[styles.goalPill, sessionComplete && styles.goalPillMet]}>
              <ThemedText style={styles.goalText}>
                {sessionPos}/{sessionTotal}
              </ThemedText>
            </View>
          )}
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
            <View style={styles.stackWrap}>
              {/* Third card peeking deeper in the stack. Static — purely
                  decorative depth cue, never animated. */}
              {queue[pos + 2] && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.stackLayer,
                    {
                      opacity: 0.3,
                      transform: [{ scale: 0.88 }, { translateY: BACK_TRANSLATE_Y * 2 }],
                    },
                  ]}>
                  <View style={styles.stackPlaceholder} />
                </View>
              )}

              {/* Second card — the next one in the queue. Renders its real
                  front text so when it animates up to take the front position,
                  the content is already there (no flash). The hidden back
                  block mirrors the front card's layout so both have identical
                  height — when the next card promotes to front, the card edges
                  stay put instead of snapping to a new size. */}
              {queue[pos + 1] && (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.stackLayer,
                    {
                      opacity: nextOpacity,
                      transform: [{ scale: nextScale }, { translateY: nextTranslateY }],
                    },
                  ]}>
                  <BlurView tint="systemThickMaterialDark" intensity={50} style={styles.card}>
                    <ThemedText style={[styles.faceLabel, { color: accent }]}>FRONT</ThemedText>
                    <RichText text={queue[pos + 1].front} style={styles.front} />
                    <View
                      style={[styles.answerWrap, styles.hiddenSpacer]}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants">
                      <View style={styles.divider} />
                      <ThemedText style={[styles.faceLabel, { color: accent }]}>BACK</ThemedText>
                      <RichText text={queue[pos + 1].back} style={styles.back} />
                    </View>
                  </BlurView>
                </Animated.View>
              )}

              {/* Front card — the one being reviewed. Slides off on rate. */}
              <Animated.View
                style={{
                  opacity: cardOpacity,
                  transform: [
                    { translateX: cardX },
                    {
                      rotate: cardSwipe.interpolate({
                        inputRange: [-1, 0, 1],
                        outputRange: ['-14deg', '0deg', '14deg'],
                      }),
                    },
                  ],
                }}>
                <BlurView tint="systemThickMaterialDark" intensity={55} style={styles.card}>
                  <ThemedText style={[styles.faceLabel, { color: accent }]}>FRONT</ThemedText>
                  <RichText text={current.front} style={styles.front} />
                  {/* Always rendered (even before reveal) so the card height is
                      constant — the back is hidden by opacity only. This keeps
                      the card, stats, and bottom row in the exact same position
                      across the front↔reveal↔next-card transitions; only the
                      opacity of the back content changes. */}
                  <Animated.View
                    pointerEvents={revealed ? 'auto' : 'none'}
                    accessibilityElementsHidden={!revealed}
                    importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
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
                </BlurView>
              </Animated.View>
            </View>

            <ThemedText style={styles.stats}>
              Cards: {reviewed} · Correct: {reviewed > 0 ? `${accuracy}%` : '—'}
            </ThemedText>

            <Animated.View style={{ opacity: bottomOpacity }}>
              {!revealed ? (
                <Pressable onPress={showAnswer} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                  <BlurView tint="systemThickMaterialDark" intensity={40} style={styles.revealBtn}>
                    <ThemedText style={styles.revealText}>Show answer</ThemedText>
                  </BlurView>
                </Pressable>
              ) : (
                <View style={styles.ratings}>
                  <RatingButton
                    color={WRONG_COLOR}
                    icon="xmark"
                    onPress={() => rate(Rating.Again)}
                  />
                  <RatingButton
                    color={CORRECT_COLOR}
                    icon="checkmark"
                    onPress={() => rate(Rating.Good)}
                  />
                </View>
              )}
            </Animated.View>
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

  // Holds the front card + two layers peeking behind it. Front card sits in
  // normal flow so it drives the wrapper's height; back layers are absolute
  // and pinned to the same rect so they scale relative to the front card.
  stackWrap: { position: 'relative' },
  stackLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  stackPlaceholder: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.15)',
  },

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
  // Reserves the same vertical space as the visible answer block, but stays
  // invisible. Used in the next-card preview so its height matches the front
  // card — the promote-to-front animation lands on the same card dimensions.
  hiddenSpacer: { opacity: 0 },
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
    // No vertical padding here — the rating buttons must occupy the same
    // height as the "Show answer" button so the bottom row doesn't shift
    // when switching between the two states.
  },
  ratingWrap: {
    flex: 1,
    maxWidth: 180,
  },
  ratingDisabled: { opacity: 0.5 },
  // Same glass treatment as revealBtn (BlurView + hairline border), tinted
  // with the intent color. The borderColor/backgroundColor get color-mixed
  // alpha overlays inline in RatingButton, so only the shared layout lives
  // here.
  ratingBtn: {
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
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
