# Cerebro interface

Cerebro is a reading desk for course PDFs: a column for reading answers, the chats you have had, and the documents you are studying with their contents.

## Black and white

The palette is two inks and greys between them. Meaning comes from weight, tone and position, not hue:

| Token | Meaning | Where |
| --- | --- | --- |
| `--ink` | Cerebro's actions | Primary buttons, selected topic, takeaways, focus rings |
| `--mark` / `--mark-line` | Text from your PDF | Page tabs (grey fill, light edge), evidence quotes in sources and quiz feedback |
| `--pencil` | Explanation not from your PDF | The rule and label of "Beyond your PDF", set in a quieter grey |

Colour appears in three places only, because there it carries a state you must not miss: quiz right and wrong (`--good`, `--bad`), destructive actions, and the model status dot.

## Themes

- Dark (default) is AMOLED black: `#000000` page and panels, so pixels stay off on OLED screens. Raised surfaces are `#141414`; panels, dialogs and the viewer are separated by 1px lines (`rgba(255,255,255,.13)`), since shadows do not show on black. Text is `#f5f5f5`, secondary `#a8a8a8`.
- Light is the same layout in reverse: white page, `#0a0a0a` ink, `#e4e4e4` lines.
- Both themes define the same token set (enforced by `test/frontend-contract.test.js`).

## Type

- Atkinson Hyperlegible Next for the interface: designed for legibility, distinct letterforms.
- Literata for answers, questions and flashcards: a typeface made for long reading on screens. Answers are set at 17px with a 68-character measure.
- Both are bundled in `public/fonts` so the app works offline.

## Layout

- Workspace: chats rail (264px) · reading desk (max 760px column) · sources panel (312px). The PDF viewer takes the sources column when a page tab is opened.
- Below 1180px the sources panel becomes a drawer; below 860px the rail does too, and the viewer goes full screen.
- The sources panel lists PDFs with tick boxes and their contents as a table of contents with dotted leaders and page numbers.
- Above the question box, a context line shows which PDFs and which topic the next question uses.

## Rules

- No borders around navigation items, no cards around messages, no gradients or glows. Hairlines only where two black surfaces meet.
- Numbers appear only where content is a sequence (quiz questions, steps).
- Motion only answers an action (drawers, the working indicator); reduced motion is respected.
- Empty states say what to do next; errors say what happened and how to fix it.
- Copy uses sentence case and plain verbs; the same action keeps the same name everywhere.

## Files

- `css/cerebro.css`: tokens, base elements, public pages, answer typography.
- `css/workspace.css`: the chat workspace, study blocks, dialogs, responsive rules.
- `js/markdown.js`: escaped Markdown, page tabs, takeaway and "Beyond your PDF" sections, study-block placeholders.
- `js/blocks.js`: interactive sources, quizzes, flashcards and practice controls.
- `js/chat.js`: workspace controller (chats, sources, streaming, viewer, settings).
