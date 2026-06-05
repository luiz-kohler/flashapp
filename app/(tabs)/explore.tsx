import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassSurface } from '@/components/glass-surface';
import { ThemedText } from '@/components/themed-text';
import { Colors, Spacing } from '@/constants/theme';
import { dailyReviewCounts } from '@/db/queries';
import { computeProgress, localDay, MOTIVATION, weeklyCounts } from '@/lib/progress';
import { useColorScheme } from '@/hooks/use-color-scheme';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']; // Dom..Sáb

export default function ProgressScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const today = localDay(new Date());
  const [data, setData] = useState(() => dailyReviewCounts().all());
  const [message, setMessage] = useState(MOTIVATION[0]);
  // Re-read review history + pick a fresh motivational line on each visit.
  useFocusEffect(
    useCallback(() => {
      setData(dailyReviewCounts().all());
      setMessage(MOTIVATION[Math.floor(Math.random() * MOTIVATION.length)]);
    }, [])
  );
  const p = computeProgress(data, today);

  const bg: [string, string] = scheme === 'dark' ? ['#101114', '#000000'] : ['#EEF2FB', '#F7F8FC'];
  const goalPct = Math.min(p.today / p.goal, 1);
  const maxBar = Math.max(...p.last7.map((d) => d.count), p.goal, 1);
  const weekly = weeklyCounts(data, today);
  const maxWeek = Math.max(...weekly.map((d) => d.count), 1);

  return (
    <View style={styles.root}>
      <LinearGradient colors={bg} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ThemedText style={styles.title}>Progresso</ThemedText>

          {/* Streak */}
          <GlassSurface radius={22} style={styles.streakCard}>
            <ThemedText style={styles.streakEmoji}>🔥</ThemedText>
            <View>
              <ThemedText style={styles.streakNum}>{p.streak}</ThemedText>
              <ThemedText style={[styles.streakLabel, { color: colors.textSecondary }]}>
                {p.streak === 1 ? 'dia de ofensiva' : 'dias de ofensiva'}
              </ThemedText>
            </View>
          </GlassSurface>

          {/* Daily goal */}
          <GlassSurface radius={22} style={styles.card}>
            <View style={styles.rowBetween}>
              <ThemedText style={styles.cardTitle}>Meta de hoje</ThemedText>
              <ThemedText style={[styles.cardTitle, { color: p.goalMet ? '#32D74B' : colors.text }]}>
                {p.today}/{p.goal}
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: colors.tabIconDefault + '40' }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${goalPct * 100}%`, backgroundColor: p.goalMet ? '#32D74B' : colors.tint },
                ]}
              />
            </View>
            <ThemedText style={[styles.cardSub, { color: colors.textSecondary }]}>
              {p.goalMet ? 'Meta batida! 🎯' : `Faltam ${p.goal - p.today} para a meta de hoje`}
            </ThemedText>
          </GlassSurface>

          {/* Level + next-level progress */}
          <GlassSurface radius={22} style={styles.card}>
            <View style={styles.rowBetween}>
              <ThemedText style={styles.cardTitle}>Nível {p.level}</ThemedText>
              <ThemedText style={[styles.cardSub, { color: colors.textSecondary }]}>
                {p.xpIntoLevel}/{p.xpForNext} XP
              </ThemedText>
            </View>
            <View style={[styles.track, { backgroundColor: colors.tabIconDefault + '40' }]}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(p.levelProgress, 1) * 100}%`, backgroundColor: colors.tint },
                ]}
              />
            </View>
            <ThemedText style={[styles.levelMsg, { color: colors.tint }]}>{message}</ThemedText>
            <ThemedText style={[styles.cardSub, { color: colors.textSecondary }]}>
              {p.totalReviews} {p.totalReviews === 1 ? 'revisão' : 'revisões'} no total
            </ThemedText>
          </GlassSurface>

          {/* Last 7 days */}
          <GlassSurface radius={22} style={styles.card}>
            <ThemedText style={styles.cardTitle}>Últimos 7 dias</ThemedText>
            <View style={styles.chart}>
              {p.last7.map((d) => {
                const isToday = d.day === today;
                const h = 6 + (d.count / maxBar) * 64;
                const weekday = WEEKDAYS[new Date(`${d.day}T00:00:00`).getDay()];
                return (
                  <View key={d.day} style={styles.barCol}>
                    <ThemedText style={[styles.barCount, { color: colors.textSecondary }]}>
                      {d.count || ''}
                    </ThemedText>
                    <View
                      style={[
                        styles.bar,
                        { height: h, backgroundColor: isToday ? colors.tint : colors.tint + '55' },
                      ]}
                    />
                    <ThemedText style={[styles.barLabel, { color: colors.textSecondary }]}>{weekday}</ThemedText>
                  </View>
                );
              })}
            </View>
          </GlassSurface>

          {/* Since the beginning (weekly totals) */}
          <GlassSurface radius={22} style={styles.card}>
            <ThemedText style={styles.cardTitle}>Desde o início</ThemedText>
            <View style={styles.chart}>
              {weekly.map((d, i) => {
                const isCurrent = i === weekly.length - 1;
                const h = 6 + (d.count / maxWeek) * 64;
                const dt = new Date(`${d.day}T00:00:00`);
                const label = `${dt.getDate()}/${dt.getMonth() + 1}`;
                return (
                  <View key={d.day} style={styles.barCol}>
                    <ThemedText style={[styles.barCount, { color: colors.textSecondary }]}>
                      {d.count || ''}
                    </ThemedText>
                    <View
                      style={[
                        styles.bar,
                        { height: h, backgroundColor: isCurrent ? colors.tint : colors.tint + '55' },
                      ]}
                    />
                    <ThemedText
                      numberOfLines={1}
                      style={[styles.barLabel, styles.weekLabel, { color: colors.textSecondary }]}>
                      {label}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          </GlassSurface>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.three },
  scroll: { gap: Spacing.three, paddingBottom: 120 },
  title: { fontSize: 34, fontWeight: '700', lineHeight: 41, paddingTop: Spacing.two },
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, padding: Spacing.four },
  streakEmoji: { fontSize: 44, lineHeight: 52 },
  streakNum: { fontSize: 40, fontWeight: '800', lineHeight: 44 },
  streakLabel: { fontSize: 14 },
  card: { padding: Spacing.four, gap: Spacing.two },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  cardSub: { fontSize: 14 },
  levelMsg: { fontSize: 14, fontWeight: '600', marginTop: Spacing.one },
  track: { height: 12, borderRadius: 6, overflow: 'hidden', marginVertical: Spacing.one },
  fill: { height: 12, borderRadius: 6 },
  statsRow: { flexDirection: 'row', gap: Spacing.three },
  statCard: { flex: 1, padding: Spacing.three, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { fontSize: 12 },
  chart: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 150, marginTop: Spacing.three },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barCount: { fontSize: 11, fontWeight: '600', lineHeight: 15, minHeight: 15, marginBottom: 4 },
  bar: { width: 22, borderRadius: 6 },
  barLabel: { fontSize: 12, fontWeight: '600', marginTop: 6 },
  weekLabel: { fontSize: 10 },
});
