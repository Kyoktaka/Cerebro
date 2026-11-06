# Study engine validation

Validated on 2026-11-06. Scope: the PDF grounding and study changes in this branch, including the new answer disclosure. This is not a new audit of every unchanged website page.

## Functional checks

- PASS: `npm test`, 13 tests. Covers model discovery, exact quote validation, malformed and fabricated output, document scope, study formats, topic filtering, equation matching, persistence, and refusals.
- PASS: `python -m unittest discover -s examples/python -p 'test_*.py'`, 5 tests. Covers the optional wrapper's source validation and local model checks.
- PASS: real `qwen2.5-coder:3b` and `nomic-embed-text` through Cerebro's HTTP API. Uploaded two PDFs, indexed them, returned a verified computer definition, refused an unsupported inventor question, and created a quiz scoped to `computer.pdf`.
- PASS: optional Python wrapper through LangChain/Ollama with real `qwen2.5-coder:3b` returned the exact source definition. Used Python 3.12 and `langchain-ollama` 1.1.0.
- PASS: Edge browser click-through with a mock Ollama service. Selected Qwen, sent a question without a PDF and received the upload instruction, uploaded two PDFs, generated scoped flashcards, opened the answer key with Enter, refused an unsupported question, and rendered multiple choice.
- PASS: reload restored the study set with its answer key initially closed; clicking Show answers revealed it.
- PASS: theme button switched light/dark at 1280px and 375px. No horizontal overflow or browser JavaScript errors. Inspected the mobile dark screenshot.

## Antislop delivery gate

Existing direction: `DESIGN.md`, ENERGY 2 / RHYTHM 2 / MOTION 1. The added disclosure keeps answers hidden for recall, uses the existing accent to identify the reveal action, and separates the key with spacing and a border. No new visual assets or page sections.

### Hard gate

| Check | Result and evidence |
| --- | --- |
| R-02 | PASS: changed UI copy contains no decorative em dashes. |
| R-03 | PASS: 375px and 1280px browser checks found no horizontal overflow. |
| R-17 | PASS: study counts come from generated items and the requested count. |
| R-18 | PASS: no testimonials added. |
| R-23 | PASS: no logos, photos, navigation structure, or other visual assets added. |
| R-24 | PASS: no navigation links added or changed. |
| R-25 | PASS: measured answer-control contrast is 5.71:1 in light mode and 12.45:1 in dark mode; surrounding text inherits existing theme colors. |
| R-26 | PASS: Show answers opens the native disclosure; verified by click and Enter. |
| R-27 | PASS: empty state requests a PDF; the existing waiting indicator remains; unsupported questions display the refusal. |
| R-28 | PASS: no FAQ added. |
| R-32 | PASS: summary receives focus and opens with Enter; global `:focus-visible` outline remains. |
| R-33 | PASS: rendering and styles are implemented directly in `chat.js` and `chat.css`. |
| R-34 | PASS: theme toggle and study disclosure checked in light and dark at both tested widths. |
| R-35 | PASS: app ran; new disclosure and affected study flow exercised as recorded above. |
| R-36 | PASS: documentation states relevance and paraphrase limitations; no perfect accuracy claim. |
| R-37 | PASS: existing `DESIGN.md` supplies the design direction and dials. |
| R-38 | PASS: study content comes from uploaded passages; synthetic PDFs were test fixtures only. |
| R-39 | PASS: native named summary, pointer cursor, 44px minimum height, hover underline, active underline weight, and visible keyboard focus. No new motion. |
| R-40 | PASS: no media or third-party scripts added; no unmeasured performance scores reported. |

### Purpose gate

| Check | Result and evidence |
| --- | --- |
| R-01 | PASS: existing solid theme surfaces; no gradient or glow added. |
| R-04 | PASS: no icon library or decorative icons added. |
| R-06 | PASS: disclosure inherits the offline system font specified in `DESIGN.md`. |
| R-07 | PASS: no background pattern added. |
| R-08 | PASS: no decorative arrows added; native disclosure marker indicates open state. |
| R-09 | PASS: no badges added. |
| R-10 | PASS: no glass surfaces added. |
| R-12 | PASS: no shadows added. |
| R-13 | PASS: no glow added. |
| R-14 | PASS: no feature-card grid added; answer key remains within its source study message. |
| R-19 | PASS: no animation added; disclosure changes state on user action. |
| R-22 | PASS: no illustrations added. |

### Liveliness

| Check | Result and evidence |
| --- | --- |
| Explicit dials | PASS: ENERGY 2 / RHYTHM 2 / MOTION 1 in `DESIGN.md`. |
| Dial consistency | PASS: compact controls and static disclosure retain the existing workspace treatment. |
| Focal point | PASS: study questions remain visible while answers are hidden. |
| Structural whitespace | PASS: 16px margin and 12px padding separate the answer key from questions. |
| Deliberate accent | PASS: existing accent marks Show answers as the study action. |
| Identity motif | PASS: answer key uses the existing document-like spacing and solid surfaces. |
| Design read | PASS: existing design read describes a local PDF study workspace. |

### Craftsmanship and quality locks

| Check | Result and evidence |
| --- | --- |
| C-1 | PASS: disclosure hides answers for active recall; spacing separates questions from evidence. |
| C-2 | PASS: new control opens and closes with native behavior. |
| C-3 | PASS: only the study response gains a disclosure; no filler sections. |
| C-4 | PASS: tested both themes, desktop/mobile widths, keyboard reveal, reload, and refusal states. |
| C-5 | PASS: source checks and limitations are documented; no invented product claims. |
| R-05 | PASS: existing conversation layout retained; no template sections introduced. |
| R-11 | PASS: disclosure adds no radius or pill treatment. |
| R-15 | PASS: Show answers names the action. |
| R-16 | PASS: changed UI copy describes PDF study without marketing buzzwords. |
| R-20 | PASS: disclosure follows Cerebro's source-and-conversation workspace identity. |
| R-21 | PASS: AMOLED dark follows the user's request; existing light toggle remains functional. |
| R-29 | PASS: new styles use existing palette variables only. |
| R-30 | PASS: no external product layout copied. |
| R-31 | PASS: control, accent, typography, and spacing purposes are recorded above. |

Comment hygiene: PASS. Added Python docstrings describe source validation or limitations; no decorative banners, narration, vague TODOs, or redundant inline comments added. Executable changes are the requested feature implementation, not comment-cleanup edits.

## Limits

The engine verifies that displayed quotations exist in the selected PDF text. That does not prove semantic relevance, factual accuracy of the PDF, or correct interpretation. Conservative keyword checks can reject paraphrases. Study generation is extractive; multiple-choice tasks require explicit lists, and short documents may yield fewer items than requested. Responses are buffered until validated. The Python example accepts already-retrieved passages; it is not a second PDF ingestion pipeline.
