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
import { getAllCardsForPractice, getDeck, getReviewsToday, getStudyQueue, recordReview } from '@/db/queries';
import type { Card } from '@/db/schema';
import { Rating, type ReviewGrade } from '@/lib/fsrs';
import { DAILY_GOAL, xpForRating } from '@/lib/progress';

const RATINGS: { grade: ReviewGrade; label: string; color: string; rgb: string }[] = [
  { grade: Rating.Again, label: 'Again', color: '#FF453A', rgb: '255,69,58' },
  { grade: Rating.Hard, label: 'Hard', color: '#FFD60A', rgb: '255,214,10' },
  { grade: Rating.Good, label: 'Good', color: '#0A84FF', rgb: '10,132,255' },
  { grade: Rating.Easy, label: 'Easy', color: '#32D74B', rgb: '50,215,75' },
];

export default function StudyScreen() {
  const { deckId, practice } = useLocalSearchParams<{ deckId: string; practice?: string }>();
  const did = Number(deckId);
  const isPractice = practice === '1';
  const deck = useMemo(() => getDeck(did), [did]);
  const accent = deck?.color ?? Colors.light.tint;

  const [queue, setQueue] = useState<Card[]>(() =>
    isPractice ? getAllCardsForPractice(did) : getStudyQueue(did)
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
  const sHard = useAudioPlayer(require('@/assets/sounds/hard.wav'));
  const sGood = useAudioPlayer(require('@/assets/sounds/good.wav'));
  const sEasy = useAudioPlayer(require('@/assets/sounds/easy.wav'));
  const soundByGrade: Record<number, ReturnType<typeof useAudioPlayer>> = {
    [Rating.Again]: sAgain,
    [Rating.Hard]: sHard,
    [Rating.Good]: sGood,
    [Rating.Easy]: sEasy,
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
                {RATINGS.map((r) => (
                  <Pressable
                    key={r.grade}
                    onPress={() => rate(r.grade)}
                    style={({ pressed }) => [
                      styles.ratingBtn,
                      {
                        backgroundColor: `rgba(${r.rgb},0.18)`,
                        borderColor: `rgba(${r.rgb},0.45)`,
                        opacity: pressed ? 0.75 : 1,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      },
                    ]}>
                    <ThemedText style={[styles.ratingLabel, { color: r.color }]}>{r.label}</ThemedText>
                  </Pressable>
                ))}
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
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  ratingBtn: {
    width: `48%`,
    flexGrow: 1,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  ratingLabel: { fontSize: 17, fontWeight: '700', textAlign: 'center', letterSpacing: 0.2 },

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
