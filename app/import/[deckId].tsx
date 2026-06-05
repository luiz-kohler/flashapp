import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { createCardsBulk } from '@/db/queries';
import { CARD_PROMPT } from '@/lib/ai-prompt';
import { parseCards } from '@/lib/parse-cards';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ImportScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const did = Number(deckId);

  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parseCards(text), [text]);

  async function copyPrompt() {
    await Clipboard.setStringAsync(CARD_PROMPT);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function add() {
    if (parsed.length === 0) return;
    createCardsBulk(did, parsed);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Importar cards</ThemedText>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <IconSymbol name="xmark" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        {/* Scrollable content — drag to dismiss keyboard; taps work while open. */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}>
          <ThemedText style={[styles.help, { color: colors.textSecondary }]}>
            Cole o texto com seus cards (um por linha, no formato{'  '}
            <ThemedText style={[styles.code, { color: colors.text }]}>frente | verso</ThemedText>). Ou
            copie o prompt, gere com uma IA e cole o resultado aqui.
          </ThemedText>

          <Pressable onPress={copyPrompt} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
            <View style={[styles.promptBtn, { borderColor: colors.tint }]}>
              <IconSymbol name="sparkles" size={18} color={colors.tint} />
              <ThemedText style={[styles.promptText, { color: colors.tint }]}>
                {copied ? 'Prompt copiado! ✓' : 'Copiar prompt da IA'}
              </ThemedText>
            </View>
          </Pressable>

          <TextInput
            style={[styles.input, { backgroundColor: colors.surface, color: colors.text }]}
            value={text}
            onChangeText={setText}
            multiline
            autoCorrect={false}
            placeholder={'Capital do Japão | Tóquio\nFunção da mitocôndria | Produzir energia (ATP)'}
            placeholderTextColor={colors.textSecondary}
            textAlignVertical="top"
          />

          <ThemedText style={[styles.count, { color: colors.textSecondary }]}>
            {parsed.length} {parsed.length === 1 ? 'card detectado' : 'cards detectados'}
          </ThemedText>
        </ScrollView>

        {/* Fixed footer — KeyboardAvoidingView lifts it above the keyboard. */}
        <Pressable
          onPress={add}
          disabled={parsed.length === 0}
          style={({ pressed }) => [
            styles.addBtn,
            { backgroundColor: colors.tint, opacity: parsed.length === 0 ? 0.4 : pressed ? 0.85 : 1 },
          ]}>
          <ThemedText style={styles.addText}>
            Adicionar {parsed.length} {parsed.length === 1 ? 'card' : 'cards'}
          </ThemedText>
        </Pressable>
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
  scroll: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three },
  help: { fontSize: 14, lineHeight: 20, marginBottom: Spacing.three },
  code: { fontWeight: '700' },
  promptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    marginBottom: Spacing.three,
  },
  promptText: { fontSize: 15, fontWeight: '700' },
  input: {
    minHeight: 200,
    borderRadius: 16,
    padding: Spacing.three,
    fontSize: 16,
    lineHeight: 22,
  },
  count: { fontSize: 13, fontWeight: '600', marginTop: Spacing.three, textAlign: 'center' },
  addBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
  },
  addText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
