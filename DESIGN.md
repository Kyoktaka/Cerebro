# Cerebro interface direction

Cerebro is a conversation-first, local PDF study assistant.

- Starting screen: one primary prompt with only the upload, quiz, flashcard and summary shortcuts.
- Authentication: compact, centered form using the existing username/password API. No nonworking Google sign-in control.
- Workspace: compact sidebar with search, new chat, document access, study tools and existing account actions.
- Conversation: centered readable answers, restrained message treatment, safe Markdown and source citations.
- PDF reading: source chips for the active documents; cited pages open in a side viewer on wide screens or full-screen on mobile, with native PDF search and zoom.
- Study: shortcut prompts reuse the existing reviewed quiz/flashcard/summary system, including its interactive one-question-at-a-time quiz flow.
- Colors: neutral light and charcoal dark surfaces with one restrained warm accent. Dark backgrounds use #212121 and #171717 for the sidebar.
- Motion: only short transitions, with reduced-motion support. Avoid marketing cards, decorative stats and fake interactions.
- Constraints: preserve authentication, chat streaming, local Ollama model selection, PDF upload and retrieval, anti-hallucination checks, answer keys and saved conversation history.

The interface is HTML, CSS and JavaScript. Business logic and API contracts remain in the existing Node server.
