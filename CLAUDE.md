@AGENTS.md

# flashapp

App de flashcards **local-first** para iPhone (Expo / React Native), com **repetição
espaçada (FSRS)**, design **"liquid glass"** estilo Apple e **gamificação**. Projeto
build-to-learn do Luiz. Roda no **Expo Go** — sem backend e sem conta paga da Apple.

## Como rodar / testar
- **Dev:** `npx expo start -c` e escanear o QR no app **Expo Go** (iPhone na mesma rede Wi-Fi).
- **Testes de lógica:** `npm run sim` (harness Node — ver abaixo).
- **Type-check:** `npx tsc --noEmit`.
- **Build de sanidade:** `npx expo export --platform ios` (compila o bundle; valida Babel/Metro/imports).
- **Gerar sons:** `npm run gen-sounds`.
- Sempre rodar comandos a partir da raiz do projeto (`cd /Users/m4/Repositories/flashapp`).

## Stack & decisões-chave
- **Expo SDK 54** (não o latest). O Expo Go é *single-SDK* e a versão da App Store é a 54;
  um projeto SDK 56 **não abre** no Expo Go. Scaffold: template `expo-template-default@sdk-54`.
- **Local-first, sem backend.** SQLite no device (`expo-sqlite`, **driver síncrono** —
  `.get()/.all()/.run()`, sem `await`) + **Drizzle ORM** (queries type-safe).
- **Schema aplicado no startup via `execSync`** (`db/migrate.ts` → `db/client.ts`), **não** via
  drizzle-kit: no SDK 54 o `babel-preset-expo` fica aninhado e não resolve de um `babel.config.js`
  custom. Por isso o projeto **não tem** `babel.config.js` / `metro.config.js` / `drizzle.config.ts`.
- **FSRS** (`ts-fsrs@5`) para agendamento. A **ordem da sessão é aleatória** (shuffle);
  `orderForStudy` (retrievabilidade) existe como utilitário opcional. A **meta diária é 21**
  cards — é um alvo, **não** um limite (a sessão mostra todos os devidos).
- **Sem IA ainda** (Luiz não tem token). Hoje cards são criados manualmente ou via **import de
  texto colado** (`frente | verso`), gerado por uma IA externa (prompt em `lib/ai-prompt.ts`).
  Quando houver token, a chave fica no **Keychain** (expo-secure-store), **nunca** no git.
- **"Liquid Glass"** aproximado com `expo-blur` (`components/glass-surface.tsx`). O material real
  (`expo-glass-effect`) exige **iOS 26 + Development Build**, fora do fluxo Expo Go.

## Estrutura
- `app/` — rotas (expo-router): `(tabs)/index` (decks), `(tabs)/explore` (Progresso),
  `deck/[id]`, `study/[deckId]`, `import/[deckId]`, `_layout` (Stack + `GestureHandlerRootView`).
- `db/` — `schema.ts`, `client.ts`, `migrate.ts` (DDL de startup), `queries.ts`.
- `lib/` — `fsrs.ts` (agendamento), `progress.ts` (streak/XP/gráficos), `parse-cards.ts`,
  `ai-prompt.ts`, `emojis.ts`.
- `components/` — `glass-surface.tsx`, `swipe-to-delete.tsx` (full-swipe ≥75%) + componentes do template.
- `scripts/` — `sim.ts` (harness de teste), `gen-sounds.mjs` (gera os WAVs).
- `assets/sounds/` — efeitos sonoros (WAV).
- `constants/theme.ts` — cores (light/dark) + `Spacing` + superfícies de vidro.

## Convenções (ver também AGENTS.md)
- **Conferir docs versionados do SDK 54 antes de codar** — APIs do Expo mudam entre versões;
  ler o `node_modules` real em vez de chutar assinatura.
- **Commit detalhado após cada mudança e `git push` logo em seguida** (subject curto + corpo
  explicando o quê/porquê, pra uma IA reconstruir a intenção). Identidade git: `luiz-kohler`.
- Rodar `npm run sim` ao mexer em agendamento/progresso; `tsc` limpo antes de commitar.

## Limite de testes
A **lógica** (FSRS, queries, gamificação, parser) é coberta por `scripts/sim.ts`, que roda o
código real contra um SQLite real (`better-sqlite3`) simulando sessões ao longo de dias. A **UI
renderizada** não é testável de forma headless (sem Xcode/simulador; web não roda
expo-sqlite/expo-blur) — o visual e os gestos são validados pelo Luiz no device.
