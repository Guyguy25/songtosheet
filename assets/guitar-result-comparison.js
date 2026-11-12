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

  function mount(root, job, {api, post}) {
    const controller = new AbortController();
    const {signal} = controller;
    const exportUrl = name => `/api/track?id=${encodeURIComponent(job.id)}&download=${encodeURIComponent(name)}`;
    const heading = add(root, 'h2', '', 'Quelle tablature préfères-tu ?');
    const status = add(root, 'p', 'guitar-comparison-status', 'Chargement des tablatures…');
    status.setAttribute('role', 'status');
    const cards = [];
    let active, frame, position = 0, token, saving = false, readyCount = 0;

    function decorate(data) {
      token = data.token;
      for (const card of cards) {
        const current = data.versions.find(version => version.key === card.key);
        card.badge.hidden = !current?.recommended;
        if (data.selected === card.key) card.vote.textContent = 'Ton choix ✓';
        card.vote.hidden = !data.token && data.selected !== card.key;
        card.vote.disabled = !data.token || saving || readyCount !== cards.length;
      }
      status.textContent = data.selected ? 'Ton choix a été enregistré.' :
        data.votingUnavailable ? 'Le vote est momentanément indisponible. Tu peux écouter les versions.' : '';
    }

    function display(data) {
      if (signal.aborted) return;
      if (!data.versions.length) {
        heading.hidden = true;
        status.textContent = 'Aucune tablature à comparer.';
        return;
      }
      const single = data.versions.length === 1;
      if (single) heading.textContent = 'Ta tablature';
      const grid = add(root, 'div', 'guitar-comparison-grid');
      grid.dataset.count = data.versions.length;
      const transport = add(root, 'div', 'guitar-comparison-transport');
      const time = add(transport, 'span', '', '0:00');
      const seek = add(transport, 'input', '');
      seek.type = 'range';
      seek.min = 0;
      seek.max = job.preview_duration || job.duration || 0;
      seek.step = .01;
      seek.value = 0;
      seek.disabled = true;
      seek.setAttribute('aria-label', 'Position commune de lecture');

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
        add(header, 'h3', '', single ? 'Tablature' : `Option ${index + 1}`);
        const badge = add(header, 'span', 'guitar-option-badge', 'Recommandé');
        const listen = add(header, 'button', 'btn btn-outline', 'Écouter');
        listen.type = 'button';
        listen.disabled = true;
        const score = add(card, 'section', 'score-player guitar-option-player');
        const vote = add(card, 'button', 'btn btn-primary guitar-option-vote', 'Je préfère cette version');
        vote.type = 'button';
        const item = {key: version.key, badge, listen, vote, player: null};
        cards.push(item);
        item.player = window.SongToSheetPlayer.mount(score, {
          scoreUrl: exportUrl(version.score), midiUrl: exportUrl(version.midi),
          instrument: 'guitare', sourceDuration: job.duration, previewDuration: job.preview_duration,
          preferTab: true, soloSustain: version.key.startsWith('solo-'),
          accompaniment: /^(held|rhythm)-/.test(version.key), comparison: !single,
          onReady(duration) {
            if (!duration) return;
            readyCount++;
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
          listen.textContent = 'Pause';
          await item.player.play();
          if (!signal.aborted && active === item) sync();
        };
        if (!job.preview_limit) {
          const links = add(card, 'div', 'guitar-option-downloads');
          for (const [label, file] of [['MIDI', version.midi], ['MusicXML', version.score]]) {
            add(links, 'a', 'btn btn-outline', label).href = exportUrl(file);
          }
        }
        vote.onclick = async () => {
          if (!token || saving) return;
          saving = true;
          decorate(data);
          try {
            const result = await post('/api/track', {action: 'guitar_vote', id: job.id, token, choice: version.key});
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
          if (!signal.aborted) decorate(data);
        };
      }
      update(0);
      decorate(data);
    }

    api(`/api/track?id=${encodeURIComponent(job.id)}&comparison=1`, {signal}).then(display).catch(() => {
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
