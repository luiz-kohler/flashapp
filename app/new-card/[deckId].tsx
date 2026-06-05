import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/theme';
import { createCard } from '@/db/queries';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Sel = { start: number; end: number };
type Range = { start: number; end: number };

// Sort + merge overlapping/adjacent bold ranges into a canonical list.
function mergeRanges(rs: Range[]): Range[] {
  const sorted = rs.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.end >= r.start) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

// Reflect an oldText -> newText edit on the bold ranges by diffing the common
// prefix/suffix. Inserts that fall strictly inside a bold range stay bold;
// inserts at the boundary are plain (the user has to opt-in via the B button).
function adjustRanges(oldText: string, newText: string, ranges: Range[]): Range[] {
  if (oldText === newText) return ranges;
  const minLen = Math.min(oldText.length, newText.length);
  let cp = 0;
  while (cp < minLen && oldText[cp] === newText[cp]) cp++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > cp && newEnd > cp && oldText[oldEnd - 1] === newText[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  const out: Range[] = [];
  for (const r of ranges) {
    if (r.end <= cp) {
      out.push({ start: r.start, end: r.end });
    } else if (r.start >= oldEnd) {
      out.push({ start: r.start + delta, end: r.end + delta });
    } else {
      const bracketsEdit = r.start < cp && r.end > oldEnd;
      if (r.start < cp) out.push({ start: r.start, end: cp });
      if (bracketsEdit && newEnd > cp) out.push({ start: cp, end: newEnd });
      if (r.end > oldEnd) out.push({ start: oldEnd + delta, end: r.end + delta });
    }
  }
  return mergeRanges(out);
}

// Toggle bold over [sel.start, sel.end). Empty selection applies to the whole
// field (matches the previous "tap B with nothing selected" behavior).
function toggleBold(ranges: Range[], sel: Sel, textLen: number): Range[] {
  let { start, end } = sel;
  if (start === end) {
    start = 0;
    end = textLen;
  }
  if (end <= start) return ranges;
  const sorted = mergeRanges(ranges);
  let cur = start;
  for (const r of sorted) {
    if (r.start > cur) break;
    cur = Math.max(cur, r.end);
    if (cur >= end) break;
  }
  if (cur >= end) {
    const out: Range[] = [];
    for (const r of sorted) {
      if (r.end <= start || r.start >= end) {
        out.push(r);
        continue;
      }
      if (r.start < start) out.push({ start: r.start, end: start });
      if (r.end > end) out.push({ start: end, end: r.end });
    }
    return mergeRanges(out);
  }
  return mergeRanges([...sorted, { start, end }]);
}

// Serialize text + ranges back to the `**bold**` markdown the rest of the app
// already understands (study/deck screens render it via <RichText>).
function toMarkdown(text: string, ranges: Range[]): string {
  const sorted = mergeRanges(ranges);
  let out = '';
  let cur = 0;
  for (const r of sorted) {
    if (r.start > cur) out += text.slice(cur, r.start);
    out += '**' + text.slice(r.start, r.end) + '**';
    cur = r.end;
  }
  return out + text.slice(cur);
}

function renderSpans(text: string, ranges: Range[]): ReactNode {
  const sorted = mergeRanges(ranges);
  if (sorted.length === 0) return text;
  const parts: ReactNode[] = [];
  let cur = 0;
  let key = 0;
  for (const r of sorted) {
    if (r.start > cur) parts.push(<Text key={key++}>{text.slice(cur, r.start)}</Text>);
    parts.push(
      <Text key={key++} style={{ fontWeight: '800' }}>
        {text.slice(r.start, r.end)}
      </Text>
    );
    cur = r.end;
  }
  if (cur < text.length) parts.push(<Text key={key++}>{text.slice(cur)}</Text>);
  return parts;
}

export default function NewCardScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const did = Number(deckId);

  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [frontBold, setFrontBold] = useState<Range[]>([]);
  const [backBold, setBackBold] = useState<Range[]>([]);
  const [frontSel, setFrontSel] = useState<Sel>({ start: 0, end: 0 });
  const [backSel, setBackSel] = useState<Sel>({ start: 0, end: 0 });

  const canSave = front.trim().length > 0 && back.trim().length > 0;

  function save() {
    if (!canSave) return;
    createCard(did, toMarkdown(front, frontBold).trim(), toMarkdown(back, backBold).trim());
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function field(
    label: string,
    value: string,
    setValue: (t: string) => void,
    ranges: Range[],
    setRanges: (r: Range[]) => void,
    sel: Sel,
    setSel: (s: Sel) => void,
    placeholder: string,
    autoFocus = false
  ) {
    return (
      <>
        <View style={styles.fieldHead}>
          <ThemedText style={[styles.label, { color: colors.textSecondary }]}>{label}</ThemedText>
          <Pressable
            onPress={() => {
              setRanges(toggleBold(ranges, sel, value.length));
              Haptics.selectionAsync();
            }}
            style={({ pressed }) => [
              styles.boldBtn,
              { backgroundColor: colors.surface, opacity: pressed ? 0.6 : 1 },
            ]}>
            <ThemedText style={[styles.boldText, { color: colors.tint }]}>B</ThemedText>
          </Pressable>
        </View>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
          onChangeText={(t) => {
            setRanges(adjustRanges(value, t, ranges));
            setValue(t);
          }}
          onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
          multiline
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          textAlignVertical="top">
          {ranges.length > 0 ? renderSpans(value, ranges) : null}
        </TextInput>
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Novo card</ThemedText>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <IconSymbol name="xmark" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          {field(
            'FRENTE',
            front,
            setFront,
            frontBold,
            setFrontBold,
            frontSel,
            setFrontSel,
            'Pergunta ou termo',
            true
          )}
          {field(
            'VERSO',
            back,
            setBack,
            backBold,
            setBackBold,
            backSel,
            setBackSel,
            'Resposta'
          )}

          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: colors.tint, opacity: !canSave ? 0.4 : pressed ? 0.85 : 1 },
            ]}>
            <ThemedText style={styles.saveText}>Salvar card</ThemedText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  title: { fontSize: 26, fontWeight: '700' },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  boldBtn: { width: 34, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  boldText: { fontSize: 16, fontWeight: '800' },
  input: { minHeight: 96, borderRadius: 16, padding: Spacing.three, fontSize: 17, lineHeight: 23 },
  saveBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.three,
  },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
