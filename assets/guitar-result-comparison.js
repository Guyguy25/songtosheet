(() => {
  'use strict';

  const formatTime = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const add = (parent, tag, className, label) => {
    const node = document.createElement(tag);
    node.className = className;
    if (label) node.textContent = label;
    parent.append(node);
    return node;
  };

  const pitchClasses = {C:0, D:2, E:4, F:5, G:7, A:9, B:11};
  const pitchNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const chordKinds = {
    major: ['', [0,4,7]], minor: ['m', [0,3,7]], 'major-seventh': ['maj7', [0,4,7,11]],
    dominant: ['7', [0,4,7,10]], 'minor-seventh': ['m7', [0,3,7,10]],
    'suspended-second': ['sus2', [0,2,7]], 'suspended-fourth': ['sus4', [0,5,7]],
    diminished: ['dim', [0,3,6]], augmented: ['aug', [0,4,8]], power: ['5', [0,7]]
  };

  function readChords(source) {
    const part = new DOMParser().parseFromString(source, 'application/xml').querySelector('score-partwise > part');
    if (!part) return [];
    const labeled = Boolean(part.querySelector('harmony'));
    const capo = Number(part.querySelector('staff-details capo')?.textContent || 0);
    const shapes = new Map();
    const pitchClass = (step, alter) => (pitchClasses[step] + Number(alter || 0) + 12) % 12;
    const text = (node, selector) => node.querySelector(selector)?.textContent;
    let harmony, notes = [];

    function save(name, tones) {
      if (shapes.has(name)) return;
      const frets = Array(6).fill(null);
      for (const {string, fret} of tones) frets[6-string] = fret;
      shapes.set(name, {name, frets});
    }

    function finishAttack() {
      if (!labeled) {
        const pcs = new Set(notes.map(note => note.pc));
        if (pcs.size >= 3) {
          const matches = [...pcs].flatMap(root => Object.values(chordKinds)
            .filter(([, intervals]) => intervals.length === pcs.size &&
              intervals.every(interval => pcs.has((root + interval) % 12)))
            .map(([suffix]) => pitchNames[root] + suffix));
          if (matches.length === 1) save(matches[0], notes);
        }
      } else if (harmony && !shapes.has(harmony.name)) {
        for (const note of notes) {
          if (harmony.pcs.includes(note.pc)) harmony.tones.set(note.string, note);
        }
        const tones = [...harmony.tones.values()];
        const frets = tones.map(note => note.fret).filter(Boolean);
        if (harmony.pcs.every(pc => tones.some(note => note.pc === pc)) &&
            Math.max(...frets) - Math.min(...frets) <= 4) save(harmony.name, tones);
      }
      notes = [];
    }

    for (const measure of part.querySelectorAll('measure')) {
      for (const node of measure.children) {
        if (node.localName === 'harmony') {
          finishAttack();
          const step = text(node, 'root-step');
          const alter = Number(text(node, 'root-alter') || 0);
          const kind = chordKinds[text(node, 'kind')];
          const root = pitchClass(step, alter);
          harmony = kind && Number.isFinite(root) ? {
            name: step + (alter === 1 ? '#' : alter === -1 ? '♭' : '') + kind[0],
            pcs: kind[1].map(interval => (root + interval) % 12),
            tones: new Map()
          } : null;
        } else if (node.localName === 'note') {
          if (!node.querySelector('chord')) finishAttack();
          const string = Number(text(node, 'technical string'));
          const fret = Number(text(node, 'technical fret') ?? -1);
          const pc = (pitchClass(text(node, 'pitch step'), text(node, 'pitch alter')) - capo + 12) % 12;
          if (Number.isInteger(string) && string >= 1 && string <= 6 &&
              Number.isInteger(fret) && fret >= 0 && fret <= 36 && Number.isFinite(pc)) {
            notes.push({string, fret, pc});
          }
        }
      }
      finishAttack();
    }
    return [...shapes.values()];
  }

  function chordDiagram({name, frets}) {
    const item = document.createElement('li');
    item.className = 'guitar-chord';
    add(item, 'strong', '', name);
    const chart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chart.setAttribute('viewBox', '0 0 106 106');
    chart.setAttribute('role', 'img');
    const strings = ['Mi grave','La','Ré','Sol','Si','Mi aigu'];
    chart.setAttribute('aria-label', name + ' · ' + frets.map((fret, i) =>
      strings[i] + ' ' + (fret === null ? 'muette' : fret === 0 ? 'à vide' : 'case ' + fret)).join(', '));
    item.append(chart);
    const mark = (tag, attributes, label) => {
      const node = document.createElementNS(chart.namespaceURI, tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      if (label) node.textContent = label;
      chart.append(node);
    };
    const pressed = frets.filter(fret => fret > 0);
    const lowest = Math.min(...pressed);
    const first = lowest >= 5 && pressed.length ? lowest : 1;
    const rows = Math.max(4, ...pressed.map(fret => fret-first+1));
    const rowHeight = 75 / rows;
    for (let row=0; row<=rows; row++) {
      const y = 22 + row*rowHeight;
      mark('line', {x1:23, x2:93, y1:y, y2:y, 'stroke-width':row === 0 && first === 1 ? 3 : 1});
    }
    if (first > 1 && pressed.length) mark('text', {x:10, y:22+rowHeight/2}, String(first));
    frets.forEach((fret, i) => {
      const x = 23 + 14*i;
      mark('line', {x1:x, x2:x, y1:22, y2:97});
      if (fret === null) mark('text', {x, y:12}, '×');
      else if (fret === 0) mark('circle', {cx:x, cy:12, r:3.2, class:'open-string'});
      else mark('circle', {cx:x, cy:22+(fret-first+.5)*rowHeight, r:5, class:'fretted-string'});
    });
    return item;
  }

  function mount(root, job, {api, post}) {
    const piano = job.instrument === 'piano';
    const question = piano ? 'Quelle partition piano préfères-tu ?' : 'Quelle tablature préfères-tu ?';
    const chosenTitle = piano ? 'Ta partition piano' : 'Ta tablature';
    const controller = new AbortController();
    const {signal} = controller;
    const exportUrl = name => `/api/track?id=${encodeURIComponent(job.id)}&download=${encodeURIComponent(name)}`;
    const heading = add(root, 'h2', '', question);
    const status = add(root, 'p', 'guitar-comparison-status', piano ? 'Chargement des partitions…' : 'Chargement des tablatures…');
    status.setAttribute('role', 'status');
    const cards = [];
    let active, frame, position = 0, token, saving = false;
    let voiceEnabled = false, voiceRequest;
    const loadVocals = job.downloads?.includes('vocals') ? () => {
      voiceRequest ??= fetch(exportUrl('vocals'), {signal}).then(response => {
        if (!response.ok) throw new Error('La piste voix est indisponible.');
        return response.arrayBuffer();
      }).catch(error => {voiceRequest = null; throw error;});
      return voiceRequest;
    } : null;

    function decorate(data) {
      token = data.token;
      for (const card of cards) {
        const current = data.versions.find(version => version.key === card.key);
        card.available = Boolean(current);
        card.badge.hidden = !current?.recommended;
        card.badge.textContent = current?.recommendation_source === 'ai' ? 'Recommandé par l’IA' : 'Recommandé';
        const chosen = data.selected === card.key;
        card.vote.textContent = chosen ? 'Ton choix ✓' : piano || cards.length > 1 ? 'Je préfère cette version' : 'Choisir cette tablature';
        card.vote.hidden = !piano && !data.token && !chosen;
        card.vote.disabled = chosen || (!piano && !data.token) || saving || card.listen.disabled;
      }
      status.textContent = data.selected ? 'Ton choix a été enregistré.' :
        data.votingUnavailable ? 'Le vote est momentanément indisponible. Tu peux écouter les versions.' : '';
    }

    function display(data) {
      if (signal.aborted) return;
      if (!data.versions.length) {
        heading.hidden = true;
        status.textContent = piano ? 'Aucune partition à comparer.' : 'Aucune tablature à comparer.';
        return;
      }
      const single = data.versions.length === 1;
      if (single) heading.textContent = chosenTitle;
      const chords = piano ? null : add(root, 'section', 'guitar-chords');
      if (chords) {
        chords.hidden = true;
        add(chords, 'h3', '', 'Accords de cette tablature');
      }
      const diagrams = chords && add(chords, 'ul', 'guitar-chord-list');
      let focused;
      const showChords = () => {
        if (!chords) return;
        const shapes = (focused || (single ? cards[0] : null))?.chords || [];
        diagrams.replaceChildren(...shapes.map(chordDiagram));
        chords.hidden = !shapes.length;
      };
      const grid = add(root, 'div', 'guitar-comparison-grid');
      grid.dataset.count = data.versions.length;
      const back = add(root, 'button', 'btn btn-outline guitar-comparison-back', '← Comparer les versions');
      back.type = 'button';
      back.hidden = true;
      const transport = add(root, 'div', 'guitar-comparison-transport');
      root.insertBefore(transport, grid);
      const time = add(transport, 'span', '', '0:00');
      const seek = add(transport, 'input', '');
      seek.type = 'range';
      seek.min = 0;
      seek.max = job.preview_duration || job.duration || 0;
      seek.step = .01;
      seek.value = 0;
      seek.disabled = true;
      seek.setAttribute('aria-label', 'Position commune de lecture');
      const voice = loadVocals ? add(transport, 'button', 'guitar-comparison-voice', '🎙 Voix isolée') : null;
      if (voice) {
        voice.type = 'button';
        voice.setAttribute('aria-label', piano ? 'Écouter la voix isolée avec la partition piano' : 'Écouter la voix isolée avec la tablature');
        voice.setAttribute('aria-pressed', 'false');
        voice.onclick = async () => {
          voiceEnabled = !voiceEnabled;
          voice.setAttribute('aria-pressed', String(voiceEnabled));
          try {
            if (voiceEnabled) await loadVocals();
            if (signal.aborted) return;
            await active?.player.setVocals(voiceEnabled);
          } catch {
            if (signal.aborted) return;
            voiceEnabled = false;
            voice.setAttribute('aria-pressed', 'false');
            status.textContent = 'La piste voix est indisponible.';
          }
        };
      }

      function focusOption(item, focus = false) {
        if (active && active !== item && item) {
          position = active.player.position();
          active.player.pause();
          active.listen.textContent = 'Écouter';
          active = null;
          cancelAnimationFrame(frame);
          update(position);
        }
        for (const card of cards) card.element.hidden = !card.available || Boolean(item && card !== item);
        grid.dataset.count = item ? 1 : cards.filter(card => card.available).length;
        grid.classList.toggle('is-focused', Boolean(item));
        heading.textContent = item || single ? chosenTitle : question;
        back.hidden = !item || single;
        focused = item;
        showChords();
        if (focus) {
          item.listen.focus({preventScroll:true});
          transport.scrollIntoView({block:'nearest'});
        }
      }
      back.onclick = () => {focusOption(null);heading.tabIndex = -1;heading.focus();};

      function update(value, source) {
        position = value;
        time.textContent = `${formatTime(position)} / ${formatTime(Number(seek.max))}`;
        seek.value = position;
        for (const card of cards) if (card !== source) card.player.seek(position);
      }
      function sync() {
        if (!active) return;
        update(active.player.position(), active);
        if (active.player.playing()) frame = requestAnimationFrame(sync);
        else {
          active.listen.textContent = 'Écouter';
          active = null;
        }
      }
      seek.oninput = () => update(Number(seek.value));

      for (const [index, version] of data.versions.entries()) {
        const card = add(grid, 'article', 'guitar-option');
        const header = add(card, 'header', 'guitar-option-header');
        add(header, 'h3', '', piano ? version.label : single ? 'Tablature' : `Option ${index + 1}`);
        const badge = add(header, 'span', 'guitar-option-badge', 'Recommandé');
        const listen = add(header, 'button', 'btn btn-outline', 'Écouter');
        listen.type = 'button';
        listen.disabled = true;
        const score = add(card, 'section', 'score-player guitar-option-player');
        const vote = add(card, 'button', 'btn btn-primary guitar-option-vote', 'Je préfère cette version');
        vote.type = 'button';
        const item = {key: version.key, element:card, badge, listen, vote, player: null};
        cards.push(item);
        item.player = window.SongToSheetPlayer.mount(score, {
          scoreUrl: exportUrl(version.score), midiUrl: exportUrl(version.midi),
          instrument: job.instrument, sourceDuration: job.duration, previewDuration: job.preview_duration,
          preferTab: !piano, soloSustain: version.key.startsWith('solo-'),
          accompaniment: /^(held|rhythm)-/.test(version.key), comparison: piano || !single, loadVocals,
          onNotation: piano ? undefined : function(source) {
            if (item.chords) return;
            item.chords = readChords(source);
            if (focused === item || single) showChords();
          },
          onReady(duration) {
            if (!duration) return;
            listen.disabled = false;
            seek.disabled = false;
            seek.max = Math.max(Number(seek.max), duration);
            item.player.seek(position);
            decorate(data);
          },
        });
        listen.onclick = async () => {
          const same = active === item;
          if (active) {
            position = active.player.position();
            active.player.pause();
            active.listen.textContent = 'Écouter';
          }
          cancelAnimationFrame(frame);
          active = same ? null : item;
          if (same) { update(position); return; }
          item.player.seek(position);
          const vocals = item.player.setVocals(voiceEnabled).catch(() => {
            if (signal.aborted || active !== item || !voice) return;
            voiceEnabled = false;
            voice.setAttribute('aria-pressed', 'false');
            status.textContent = 'La piste voix est indisponible.';
          });
          listen.textContent = 'Pause';
          await item.player.play();
          await vocals;
          if (!signal.aborted && active === item) sync();
        };
        if (!job.preview_limit) {
          const links = add(card, 'div', 'guitar-option-downloads');
          for (const [label, file] of [['MIDI', version.midi], ['MusicXML', version.score]]) {
            add(links, 'a', 'btn btn-outline', label).href = exportUrl(file);
          }
        }
        vote.onclick = async () => {
          if ((!piano && !token) || saving) return;
          saving = true;
          decorate(data);
          try {
            const result = await post('/api/track', {
              action: piano ? 'piano_choice' : 'guitar_vote', id: job.id, token, choice: version.key
            });
            if (!signal.aborted) Object.assign(data, result);
          } catch (error) {
            if (!signal.aborted) {
              saving = false;
              decorate(data);
              status.textContent = error.message;
            }
            return;
          }
          saving = false;
          if (!signal.aborted) {
            decorate(data);
            const selected = cards.find(card => card.key === data.selected);
            if (selected) focusOption(selected, true);
          }
        };
      }
      update(0);
      decorate(data);
      const selected = cards.find(card => card.key === data.selected);
      if (selected) focusOption(selected);
    }

    if (piano) display({
      versions: job.piano_versions.map(version => ({...version, recommendation_source: 'ai'})),
      selected: job.piano_choice
    });
    else api(`/api/track?id=${encodeURIComponent(job.id)}&comparison=1`, {signal}).then(display).catch(() => {
      if (!signal.aborted) status.textContent = 'Comparaison indisponible. Actualise cette page pour réessayer.';
    });
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      for (const card of cards) card.player?.();
      root.remove();
    };
  }

  window.SongToSheetGuitarComparison = {mount};
})();
