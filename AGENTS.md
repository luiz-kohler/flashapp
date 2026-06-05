# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

# Language

The app is in **English**. All user-facing strings (labels, buttons, alerts, placeholders,
empty states, AI prompt, motivational lines, sim test descriptions) must be written in
English. Use English for any new feature by default — don't introduce Portuguese strings
even if the conversation with Luiz is in Portuguese.

# Commits

Keep a detailed, linear history on `main` so an AI (or human) can reconstruct intent from `git log`.
Commit after each meaningful change:

- **Subject**: concise, imperative, ≤ ~70 chars (e.g. "Add full-swipe to delete").
- **Body**: WHAT changed and WHY, in bullets, naming the files/features touched and noting any
  decision or tradeoff — enough that the next AI understands without reading the chat.
- Run `npm run sim` before committing changes to scheduling/progress logic.
- Verify the git identity is Luiz's (`luiz-kohler` / `luizkohler@icloud.com`) before committing.
- **Always `git push` right after committing** (remote `origin` → github.com/luiz-kohler/flashapp).
