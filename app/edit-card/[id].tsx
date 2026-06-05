import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors, Spacing } from '@/constants/theme';
import { getCard, updateCard } from '@/db/queries';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function EditCardScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { id } = useLocalSearchParams<{ id: string }>();
  const cardId = Number(id);

  // Read once on mount: the card is loaded synchronously from SQLite, so we
  // can seed the inputs directly without a loading state.
  const initial = getCard(cardId);
  const [front, setFront] = useState(initial?.front ?? '');
  const [back, setBack] = useState(initial?.back ?? '');

  const canSave = front.trim().length > 0 && back.trim().length > 0;

  function save() {
    if (!canSave) return;
    updateCard(cardId, { front: front.trim(), back: back.trim() });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function field(
    label: string,
    value: string,
    setValue: (t: string) => void,
    placeholder: string,
    autoFocus = false
  ) {
    return (
      <>
        <ThemedText style={[styles.label, { color: colors.textSecondary }]}>{label}</ThemedText>
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
          value={value}
          onChangeText={setValue}
          multiline
          autoFocus={autoFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          textAlignVertical="top"
        />
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Edit card</ThemedText>
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
          {field('FRONT', front, setFront, 'Question or term', true)}
          {field('BACK', back, setBack, 'Answer')}

          <Pressable
            onPress={save}
            disabled={!canSave}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: colors.tint, opacity: !canSave ? 0.4 : pressed ? 0.85 : 1 },
            ]}>
            <ThemedText style={styles.saveText}>Save changes</ThemedText>
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
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: Spacing.two },
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
