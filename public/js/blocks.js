/* Interactive study blocks inside answers: sources, quizzes, flashcards and
   the one-question-at-a-time practice controls. State lives in the page only;
   nothing here claims to track progress across sessions. */
(function (global) {
    const { escapeHtml: esc } = global.CerebroMarkdown;
    const LETTERS = 'ABCD';

    function tab(source) {
        if (!source.digest || !source.page) return `<span class="page-tab is-static">${esc(source.doc.replace(/\.pdf$/i, ''))}${source.page ? ' p.&nbsp;' + source.page : ''}</span>`;
        return `<button type="button" class="page-tab" data-digest="${source.digest}" data-page="${source.page}" data-doc="${esc(source.doc)}" title="Open ${esc(source.doc)} at page ${source.page}"><span class="page-tab-doc">${esc(source.doc.replace(/\.pdf$/i, ''))}</span> p.&nbsp;${source.page}</button>`;
    }

    function sources(data) {
        const list = Array.isArray(data) ? data : [];
        if (!list.length) return '';
        const docs = [...new Set(list.map(item => item.doc))];
        const label = list.length === 1 ? '1 source' : `${list.length} sources`;
        return `<details class="sources"><summary><span>${label}</span><span class="sources-docs">${esc(docs.join(', '))}</span></summary><ol>` +
            list.map(item => `<li>${tab(item)}${item.section ? `<span class="source-section">${esc(item.section)}</span>` : ''}<p class="evidence">${esc(item.excerpt || '')}</p></li>`).join('') +
            '</ol></details>';
    }

    function evidence(item) {
        return `<p class="evidence">${esc(item.source.quote)}</p><p class="feedback-source">${tab(item.source)}</p>`;
    }

    function quiz(data) {
        const items = data.items || [];
        return `<div class="quiz" data-total="${items.length}">
            <div class="set-head"><p class="set-progress" aria-live="polite">0 of ${items.length} answered</p><button type="button" class="text-button" data-reveal-all>Show all answers</button></div>
            <ol class="quiz-items">${items.map((item, i) => `
                <li class="quiz-item" data-index="${i}" data-correct="${item.correct ?? ''}">
                    <p class="quiz-question"><span class="difficulty" data-level="${esc(item.difficulty)}">${esc(item.difficulty)}</span>${esc(item.question)}</p>
                    ${item.choices?.length ? `<div class="choices" role="group" aria-label="Choices for question ${i + 1}">${item.choices.map((choice, c) =>
                        `<button type="button" class="choice" data-choice="${c}"><span class="choice-letter">${LETTERS[c]}</span><span>${esc(choice)}</span></button>`).join('')}</div>`
                        : `<button type="button" class="text-button" data-show-answer>Show answer</button>`}
                    <div class="feedback" hidden>
                        <p class="feedback-verdict"></p>
                        <p><strong>${esc(item.answer)}.</strong> ${esc(item.explanation)}</p>
                        ${evidence(item)}
                    </div>
                </li>`).join('')}
            </ol></div>`;
    }

    function flashcards(data) {
        const items = data.items || [];
        return `<div class="deck" data-total="${items.length}">
            <p class="set-progress" aria-live="polite"></p>
            <div class="deck-stage">${items.map((card, i) => `
                <div class="flashcard" data-index="${i}" hidden>
                    <button type="button" class="flashcard-face" aria-pressed="false" aria-label="Flip card">
                        <span class="flashcard-side flashcard-front"><span class="flashcard-type">${esc(card.type || 'concept')}</span><span class="flashcard-text">${esc(card.front)}</span><span class="flashcard-hint">Tap or press Space to flip</span></span>
                        <span class="flashcard-side flashcard-back"><span class="flashcard-text">${esc(card.back)}</span>${card.example ? `<span class="flashcard-example">${card.exampleFromPdf ? 'Example' : 'Example (not from your PDF)'}: ${esc(card.example)}</span>` : ''}</span>
                    </button>
                    <p class="feedback-source">${tab(card.source)}</p>
                </div>`).join('')}
                <div class="deck-done" hidden></div>
            </div>
            <div class="deck-controls">
                <button type="button" class="ghost-button" data-deck="prev" aria-label="Previous card"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
                <button type="button" class="ghost-button" data-deck="again">Study again</button>
                <button type="button" class="solid-button" data-deck="known">I knew it</button>
                <button type="button" class="ghost-button" data-deck="next" aria-label="Next card"><i class="fas fa-arrow-right" aria-hidden="true"></i></button>
            </div></div>`;
    }

    function practice(data) {
        const choices = data.choices || [];
        return `<div class="practice" role="group" aria-label="Answer question ${data.index + 1}">
            ${choices.length ? `<div class="choices">${choices.map((choice, i) =>
                `<button type="button" class="choice" data-send="${LETTERS[i]}"><span class="choice-letter">${LETTERS[i]}</span><span>${esc(choice)}</span></button>`).join('')}</div>` : ''}
            <div class="practice-actions"><button type="button" class="text-button" data-send="hint">Hint</button><button type="button" class="text-button" data-send="skip">Skip</button><button type="button" class="text-button" data-send="stop">Stop</button></div>
        </div>`;
    }

    const RENDER = { sources, quiz, flashcards, practice };

    function hydrate(root) {
        root.querySelectorAll('.study-block[data-json]').forEach(node => {
            let data;
            try { data = JSON.parse(node.dataset.json); } catch { node.remove(); return; }
            node.innerHTML = RENDER[node.dataset.block]?.(data) || '';
            node.removeAttribute('data-json');
            if (node.dataset.block === 'flashcards') deck(node.querySelector('.deck'));
            // The message text lists the choices for copying; the buttons replace them on screen.
            if (node.dataset.block === 'practice') {
                const choices = node.previousElementSibling;
                if (choices?.tagName === 'P' && /^A\. /.test(choices.textContent)) choices.hidden = true;
            }
        });
    }

    function answer(item, choice) {
        if (item.classList.contains('is-answered')) return;
        const correct = Number(item.dataset.correct);
        item.classList.add('is-answered');
        item.querySelectorAll('.choice').forEach(button => {
            const index = Number(button.dataset.choice);
            button.disabled = true;
            if (index === correct) button.classList.add('is-correct');
            if (index === choice && choice !== correct) button.classList.add('is-wrong');
            if (index === choice) button.setAttribute('aria-pressed', 'true');
        });
        const feedback = item.querySelector('.feedback');
        const verdict = feedback.querySelector('.feedback-verdict');
        if (choice === null) verdict.textContent = 'Answer';
        else verdict.textContent = choice === correct ? 'Correct' : 'Not quite';
        verdict.dataset.result = choice === null ? 'shown' : choice === correct ? 'right' : 'wrong';
        feedback.hidden = false;
        const set = item.closest('.quiz');
        const answered = set.querySelectorAll('.quiz-item.is-answered').length;
        const right = set.querySelectorAll('.feedback-verdict[data-result="right"]').length;
        const total = Number(set.dataset.total);
        set.querySelector('.set-progress').textContent = answered === total
            ? `Done: ${right} of ${total} correct on the first try`
            : `${answered} of ${total} answered · ${right} correct`;
    }

    function deck(root) {
        if (!root) return;
        const cards = [...root.querySelectorAll('.flashcard')];
        const progress = root.querySelector('.set-progress');
        const done = root.querySelector('.deck-done');
        let queue = cards.map((_, i) => i);
        let position = 0;
        const known = new Set();
        const show = () => {
            cards.forEach(card => { card.hidden = true; });
            if (!queue.length) {
                done.hidden = false;
                const missed = cards.filter((_, i) => !known.has(i)).length;
                done.innerHTML = `<p><strong>Deck finished.</strong> You knew ${known.size} of ${cards.length}.</p><p>${missed ? 'Cards marked "Study again" came back until you knew them. ' : ''}Review this deck again tomorrow, then in a few days.</p><button type="button" class="ghost-button" data-deck="restart">Start over</button>`;
                progress.textContent = '';
                root.querySelectorAll('.deck-controls button').forEach(button => { button.disabled = true; });
                return;
            }
            done.hidden = true;
            position = Math.min(position, queue.length - 1);
            const card = cards[queue[position]];
            card.hidden = false;
            const face = card.querySelector('.flashcard-face');
            face.setAttribute('aria-pressed', 'false');
            card.classList.remove('is-flipped');
            progress.textContent = `${queue.length} card${queue.length > 1 ? 's' : ''} left · ${known.size} known`;
            root.querySelectorAll('.deck-controls button').forEach(button => { button.disabled = false; });
        };
        root.addEventListener('click', event => {
            const face = event.target.closest('.flashcard-face');
            if (face) {
                const card = face.closest('.flashcard');
                const flipped = card.classList.toggle('is-flipped');
                face.setAttribute('aria-pressed', String(flipped));
                return;
            }
            const action = event.target.closest('[data-deck]')?.dataset.deck;
            if (!action) return;
            if (action === 'restart') {
                queue = cards.map((_, i) => i);
                known.clear();
                position = 0;
            } else if (action === 'next') position = (position + 1) % queue.length;
            else if (action === 'prev') position = (position - 1 + queue.length) % queue.length;
            else if (action === 'known') {
                known.add(queue[position]);
                queue.splice(position, 1);
            } else if (action === 'again') {
                const [card] = queue.splice(position, 1);
                queue.push(card);
            }
            show();
        });
        show();
    }

    // Delegated quiz interactions; works for messages rendered at any time.
    document.addEventListener('click', event => {
        const choice = event.target.closest('.quiz .choice');
        if (choice) return answer(choice.closest('.quiz-item'), Number(choice.dataset.choice));
        const show = event.target.closest('[data-show-answer]');
        if (show) {
            show.remove();
            return answer(show.closest('.quiz-item'), null);
        }
        const all = event.target.closest('[data-reveal-all]');
        if (all) {
            all.closest('.quiz').querySelectorAll('.quiz-item:not(.is-answered)').forEach(item => {
                item.querySelector('[data-show-answer]')?.remove();
                answer(item, null);
            });
            all.remove();
        }
    });

    global.CerebroBlocks = { hydrate };
})(window);
