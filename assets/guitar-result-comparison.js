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

  function mount(root, job, {api, post, fullStatus = () => 'completed'}) {
    // Versions whose whole song was generated (failed ones can be generated again).
    const owned = Object.fromEntries(Object.entries(job.full_jobs || {})
      .filter(([, id]) => fullStatus(id) !== 'failed'));
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
    // The page header offers a slot for the playback controls; fall back to the comparison itself.
    const bar = document.getElementById('score-bar-controls');
    const versionLinks = document.getElementById('score-download-version');
    let active, frame, position = 0, token, saving = false;
    let showPlay = () => {}, showVoice = () => {}, justVoted = false;
    let voiceEnabled = false, voiceRequest, voiceVolume = .4;
    const loadVocals = job.downloads?.includes('vocals') ? () => {
      voiceRequest ??= fetch(exportUrl('vocals'), {signal}).then(response => {
        if (!response.ok) throw new Error('La piste voix est indisponible.');
        return response.arrayBuffer();
      }).catch(error => {voiceRequest = null; throw error;});
      return voiceRequest;
    } : null;
    // La voix accompagne l'écoute par défaut ; c'est à l'utilisateur de la retirer.
    voiceEnabled = Boolean(loadVocals);
    loadVocals?.().catch(() => {});

    function decorate(data) {
      token = data.token;
      for (const card of cards) {
        const current = data.versions.find(version => version.key === card.key);
        card.available = Boolean(current);
        card.badge.hidden = !current?.recommended;
        card.badge.textContent = current?.recommendation_source === 'ai' ? 'Recommandé par l’IA' : 'Recommandé';
        if (card.summary) {
          card.summary.textContent = current?.recommended && data.summary ? data.summary : '';
          card.summary.hidden = !card.summary.textContent;
        }
        const chosen = data.selected === card.key;
        card.vote.textContent = chosen ? 'Ton choix ✓' : piano || cards.length > 1 ? 'Choisir cette version' : 'Choisir cette tablature';
        card.vote.classList.toggle('is-chosen', chosen);
        card.vote.hidden = (!piano && !data.token && !chosen) || Boolean(owned[card.key]);
        if (Object.keys(owned).length && !owned[card.key]) {
          // Another version is already paid for: this one is unlocked from here, for its whole song.
          card.vote.textContent = '🔒 Débloquer cette version en entier';
          card.vote.classList.remove('is-chosen');
          card.vote.hidden = false;
          card.vote.disabled = saving;
        }
        card.vote.disabled = chosen || (!piano && !data.token) || saving || card.listen.disabled;
      }
      status.textContent = data.selected ? (justVoted ? 'Ton choix a été enregistré.' : '') :
        data.votingUnavailable ? 'Le vote est momentanément indisponible. Tu peux écouter les versions.' :
        data.recommendationStatus === 'close' ? (data.versions.some(version => version.recommended) ?
          'Versions très proches selon l’analyse audio : l’IA penche pour celle qui porte le badge. Écoute aussi l’autre.' :
          'Versions proches selon l’analyse audio. Écoute-les pour choisir.') :
        data.recommendationStatus === 'uncertain' ? 'Analyse audio incertaine. Écoute les versions pour choisir.' :
        piano && data.versions.some(version => version.recommended) ?
          (data.summary ? 'L’IA a écouté le morceau et comparé chaque version : la plus fidèle et jouable porte le badge.' :
            'Le badge indique la version qui se rapproche le plus du morceau selon l’analyse audio.') : '';
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
      const grid = add(root, 'div', 'guitar-comparison-grid' + (piano ? ' piano-comparison-grid' : ''));
      grid.dataset.count = data.versions.length;
      const transport = add(bar || root, 'div', 'guitar-comparison-transport');
      if (!bar) root.insertBefore(transport, grid);
      const playButton = add(transport, 'button', 'score-play', '▶');
      playButton.type = 'button';
      playButton.disabled = true;
      const time = add(transport, 'span', 'score-time', '0:00');
      const seek = add(transport, 'input', '');
      seek.type = 'range';
      seek.min = 0;
      seek.max = job.preview_duration || job.duration || 0;
      seek.step = .01;
      seek.value = 0;
      seek.disabled = true;
      seek.setAttribute('aria-label', 'Position commune de lecture');
      const tools = add(bar || root, 'div', 'score-tools');
      if (!bar) root.insertBefore(tools, grid);
      const speed = add(tools, 'select', 'score-speed');
      speed.setAttribute('aria-label', 'Vitesse de lecture');
      for (const value of [.5, .75, 1, 1.25, 1.5]) {
        const option = add(speed, 'option', '', String(value).replace('.', ',') + '×');
        option.value = value;
        option.selected = value === 1;
      }
      speed.onchange = () => {
        for (const card of cards) {
          const control = card.element.querySelector('.sp-speed select');
          if (!control || control.disabled) continue;
          control.value = speed.value;
          control.dispatchEvent(new Event('change'));
        }
      };
      const mix = loadVocals ? add(tools, 'div', 'comparison-voice-mix') : null;
      const voice = mix ? add(mix, 'button', 'guitar-comparison-voice', 'Voix') : null;
      if (voice) {
        const slider = add(mix, 'input', '');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 100;
        slider.step = 1;
        slider.value = 40;
        slider.hidden = true;
        slider.oninput = () => {
          voiceVolume = Number(slider.value) / 100;
          slider.setAttribute('aria-label', `Volume de la voix · ${slider.value} %`);
          slider.title = `Volume voix · ${slider.value} %`;
          active?.player.setVocalVolume(voiceVolume);
        };
        slider.oninput();
        showVoice = () => {
          voice.setAttribute('aria-pressed', String(voiceEnabled));
          const label = voiceEnabled ? 'Retirer la voix isolée' : 'Ajouter la voix isolée';
          voice.setAttribute('aria-label', label);
          voice.title = label + ' pendant l’écoute';
          slider.hidden = !voiceEnabled;
        };
        voice.type = 'button';
        showVoice();
        voice.onclick = async () => {
          voiceEnabled = !voiceEnabled;
          showVoice();
          try {
            if (voiceEnabled) await loadVocals();
            if (signal.aborted) return;
            active?.player.setVocalVolume(voiceVolume);
            await active?.player.setVocals(voiceEnabled);
          } catch {
            if (signal.aborted) return;
            voiceEnabled = false;
            showVoice();
            status.textContent = 'La piste voix est indisponible.';
          }
        };
      }
      const zoom = add(tools, 'div', 'score-zoom');
      zoom.setAttribute('role', 'group');
      zoom.setAttribute('aria-label', piano ? 'Taille de la partition' : 'Taille de la tablature');
      for (const [step, label, text] of [[-1, 'Réduire', '−'], [1, 'Agrandir', '+']]) {
        const button = add(zoom, 'button', '', text);
        button.type = 'button';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.onclick = () => {
          for (const card of cards) card.element.querySelector(`[data-zoom="${step}"]`)?.click();
        };
      }
      const back = add(tools, 'button', 'guitar-comparison-back', 'Comparer les versions');
      back.type = 'button';
      back.hidden = true;

      const target = () => active || focused || cards.find(card => card.lastPlayed && card.available) ||
        cards.find(card => card.available && !card.badge.hidden) || cards.find(card => card.available);
      showPlay = () => {
        playButton.textContent = active ? '❚❚' : '▶';
        playButton.setAttribute('aria-label', active ? 'Mettre en pause' : 'Écouter');
        playButton.disabled = !cards.some(card => card.available && !card.listen.disabled);
        for (const card of cards) {
          card.listen.textContent = card === active ? 'Pause' : 'Écouter';
          card.element.classList.toggle('is-playing', card === active);
        }
      };
      playButton.onclick = () => target()?.listen.onclick();
      const showDownloads = () => {
        if (!versionLinks || job.preview_limit) return;
        const shown = focused ? [focused] : cards.filter(card => card.available);
        versionLinks.replaceChildren();
        for (const card of shown) {
          add(versionLinks, 'h3', '', focused || single ? (piano ? 'Cette version' : 'Cette tablature') : card.title);
          for (const [label, hint, file] of [['MIDI', 'Pour un logiciel de musique', card.files.midi],
            ['MusicXML', 'Pour un éditeur de partitions', card.files.score]]) {
            const link = add(versionLinks, 'a', '');
            link.href = exportUrl(file);
            add(link, 'b', '', label);
            add(link, 'small', '', hint);
          }
        }
      };

      function focusOption(item, focus = false) {
        if (active && active !== item && item) {
          position = active.player.position();
          active.player.pause();
          active = null;
          cancelAnimationFrame(frame);
          update(position);
        }
        for (const card of cards) card.element.hidden = !card.available || Boolean(item && card !== item);
        grid.dataset.count = item ? 1 : cards.filter(card => card.available).length;
        grid.classList.toggle('is-focused', Boolean(item));
        heading.textContent = item || single ? chosenTitle : question;
        heading.hidden = Boolean(item) || single;
        root.classList.toggle('is-single', Boolean(item) || single);
        back.hidden = !item || single;
        focused = item;
        if (!piano) for (const card of cards) card.player?.setZoom((item || single) && matchMedia('(min-width: 900px)').matches ? 1.3 : 1);
        showChords();
        showDownloads();
        showPlay();
        if (focus) {
          playButton.focus({preventScroll:true});
          root.closest('.app-scroll')?.scrollTo({top:0});
        }
      }
      back.onclick = () => {justVoted = false;status.textContent = '';focusOption(null);heading.tabIndex = -1;heading.focus({preventScroll:true});};

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
          active = null;
          showPlay();
        }
      }
      seek.oninput = () => update(Number(seek.value));

      for (const [index, version] of data.versions.entries()) {
        const card = add(grid, 'article', 'guitar-option');
        const header = add(card, 'header', 'guitar-option-header');
        const title = piano ? version.label : single ? 'Tablature' : `Option ${index + 1}`;
        add(header, 'h3', '', title);
        const badge = add(header, 'span', 'guitar-option-badge', 'Recommandé');
        const listen = add(header, 'button', 'btn btn-outline', 'Écouter');
        listen.type = 'button';
        listen.disabled = true;
        let summary = null;
        if (piano) {
          if (version.hint) add(card, 'p', 'piano-option-hint', version.hint);
          const measured = version.criteria || {};
          const parts = [['melody', 'Mélodie'], ['harmony', 'Accords'], ['playability', 'Jouabilité']]
            .filter(([name]) => Number.isInteger(measured[name]))
            .map(([name, label]) => `${label} ${measured[name]} %`);
          if (parts.length) {
            const row = add(card, 'p', 'piano-option-criteria', parts.join(' · '));
            row.title = 'Mesures de l’analyse audio comparée au morceau original';
          }
          summary = add(card, 'p', 'piano-option-ai', '');
          summary.hidden = true;
        }
        const score = add(card, 'section', 'score-player guitar-option-player');
        const vote = add(card, 'button', 'btn btn-primary guitar-option-vote', 'Choisir cette version');
        vote.type = 'button';
        const fullId = owned[version.key];
        if (fullId) {
          // The version already paid for: open its whole song instead of the 30 s preview.
          card.classList.add('is-complete');
          const done = fullStatus(fullId) === 'completed';
          header.insertBefore(add(header, 'span', 'guitar-option-full', done ? 'Morceau entier ✓' : 'Morceau entier en cours'), listen);
          const open = add(card, 'a', 'btn btn-primary guitar-option-open', done ? 'Ouvrir le morceau entier' : 'Suivre la génération');
          open.href = '/app/' + encodeURIComponent(fullId);
          open.dataset.openJob = fullId;
        }
        const item = {key: version.key, element:card, badge, listen, vote, title, files: version, player: null, summary};
        cards.push(item);
        item.player = window.SongToSheetPlayer.mount(score, {
          scoreUrl: exportUrl(version.score), midiUrl: exportUrl(version.midi),
          instrument: job.instrument, sourceDuration: job.duration, previewDuration: job.preview_duration, excerpt: Boolean(job.preview_limit && job.excerpt),
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
            showPlay();
          },
        });
        listen.onclick = async () => {
          const same = active === item;
          if (active) {
            position = active.player.position();
            active.player.pause();
          }
          cancelAnimationFrame(frame);
          active = same ? null : item;
          showPlay();
          if (same) { update(position); return; }
          for (const card of cards) card.lastPlayed = card === item;
          item.player.seek(position);
          item.player.setVocalVolume(voiceVolume);
          const vocals = item.player.setVocals(voiceEnabled).catch(() => {
            if (signal.aborted || active !== item || !voice) return;
            voiceEnabled = false;
            showVoice();
            status.textContent = 'La piste voix est indisponible.';
          });
          await item.player.play();
          await vocals;
          if (!signal.aborted && active === item) sync();
        };
        // quiet: the unlock dialog is opening, so the page does not rearrange behind it.
        const choose = async ({quiet = false} = {}) => {
          if ((!piano && !token) || saving) return;
          saving = true;
          decorate(data);
          try {
            const result = await post('/api/track', {
              action: piano ? 'piano_choice' : 'guitar_vote', id: job.id, token, choice: version.key
            });
            if (!signal.aborted) {Object.assign(data, result);justVoted = !quiet;}
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
            if (selected && !quiet) focusOption(selected, true);
          }
        };
        vote.onclick = () => {
          const lock = Object.keys(owned).length && !owned[version.key] && card.querySelector('.sp-lock-cta');
          if (lock) lock.click(); else choose();
        };
        // Unlocking a version from its own card is the clearest choice there is: it counts as
        // choosing that version (like downloading the take you prefer), then the unlock opens.
        card.addEventListener('click', event => {
          if (!event.target.closest('.sp-lock-cta') || data.selected === version.key) return;
          choose({quiet: true});
        }, true);
        // The lock's button acts on this version: unlock it (free) or generate its whole song (paid).
        const unlockLabel = card.querySelector('.sp-lock-cta');
        if (unlockLabel) {
          unlockLabel.dataset.variant = version.key;
          if (data.versions.length > 1) unlockLabel.dataset.freeLabel = 'Débloquer cette version';
          unlockLabel.dataset.paidLabel = job.full_jobs?.[version.key] ? 'Voir le morceau entier' : 'Générer la suite';
        }
      }
      update(0);
      decorate(data);
      const selected = cards.find(card => card.key === data.selected);
      // Once a whole song exists, this page is the overview: every version, the paid one marked.
      focusOption(Object.keys(owned).length ? null : selected || null);
    }

    if (piano) display({
      versions: job.piano_versions.map(version => ({...version, recommendation_source: 'ai'})),
      selected: job.piano_choice,
      recommendationStatus: job.piano_recommendation_status,
      summary: job.piano_recommendation_summary
    });
    else api(`/api/track?id=${encodeURIComponent(job.id)}&comparison=1`, {signal}).then(display).catch(() => {
      if (!signal.aborted) status.textContent = 'Comparaison indisponible. Actualise cette page pour réessayer.';
    });
    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      for (const card of cards) card.player?.();
      bar?.replaceChildren();
      versionLinks?.replaceChildren();
      root.remove();
    };
  }

  window.SongToSheetGuitarComparison = {mount};
})();
