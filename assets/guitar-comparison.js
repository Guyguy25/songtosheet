(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const status = get('status');
  const input = get('comparison-file');
  const player = get('comparison');
  const play = get('play');
  const seek = get('seek');
  const versionButtons = [...document.querySelectorAll('[data-version]')];
  const pdfLinks = [...document.querySelectorAll('[data-pdf]')];
  let context;
  let buffers, sources = [], gains = [], pdfUrls = [];
  let selected = 0, duration = 0, position = 0, startedAt = 0, frame, starting = false;

  const bytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
  const clock = () => sources.length ? Math.min(duration, context.currentTime - startedAt) : position;
  const label = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

  function update(value) {
    seek.value = value;
    seek.setAttribute('aria-valuetext', `${label(value)} sur ${label(duration)}`);
    get('position').textContent = `${label(value)} / ${label(duration)}`;
  }

  function stop() {
    position = clock();
    for (const source of sources.splice(0)) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    for (const gain of gains.splice(0)) gain.disconnect();
    cancelAnimationFrame(frame);
    play.textContent = 'Lire';
    update(position);
  }

  function draw() {
    const value = clock();
    update(value);
    if (value >= duration) stop();
    else frame = requestAnimationFrame(draw);
  }

  function start() {
    if (position >= duration) position = 0;
    const when = context.currentTime;
    startedAt = when - position;
    for (const [index, buffer] of buffers.entries()) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = index === selected ? 1 : 0;
      source.connect(gain).connect(context.destination);
      source.start(when, position, duration - position);
      sources.push(source);
      gains.push(gain);
    }
    sources[0].onended = stop;
    play.textContent = 'Pause';
    draw();
  }

  function select(index) {
    selected = index;
    for (const [i, button] of versionButtons.entries()) {
      button.setAttribute('aria-pressed', String(i === index));
      pdfLinks[i].setAttribute('aria-current', String(i === index));
      gains[i]?.gain.setTargetAtTime(i === index ? 1 : 0, context.currentTime, 0.007);
    }
  }

  for (const [index, button] of versionButtons.entries()) button.onclick = () => select(index);
  play.onclick = async () => {
    if (sources.length) return stop();
    if (starting || !buffers) return;
    starting = true;
    try {
      await context.resume();
      if (buffers && !player.hidden) start();
    } catch {
      status.textContent = 'La lecture audio a échoué. Réessaie.';
    } finally {
      starting = false;
    }
  };
  seek.oninput = () => {
    const target = Number(seek.value);
    const playing = sources.length > 0;
    if (playing) stop();
    position = target;
    if (playing && position < duration) start();
    else update(position);
  };

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    input.disabled = true;
    stop();
    player.hidden = true;
    buffers = undefined;
    for (const link of pdfLinks) {
      link.removeAttribute('href');
      link.parentElement.querySelector('object')?.remove();
    }
    for (const url of pdfUrls.splice(0)) URL.revokeObjectURL(url);
    status.textContent = 'Chargement des deux versions…';
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error();
      const {version, title, tracks} = JSON.parse(await file.text());
      if (version !== 1 || typeof title !== 'string' || !title || !Array.isArray(tracks) || tracks.length !== 2) throw new Error();
      const pdfs = tracks.map(track => bytes(track.pdf));
      if (pdfs.some(pdf => new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-')) throw new Error();
      context ??= new (window.AudioContext || window.webkitAudioContext)();
      buffers = await Promise.all(tracks.map(track => context.decodeAudioData(bytes(track.audio).buffer)));
      duration = Math.min(...buffers.map(buffer => buffer.duration));
      position = 0;
      seek.max = duration;
      get('comparison-title').textContent = title;
      for (const [index, link] of pdfLinks.entries()) {
        const url = URL.createObjectURL(new Blob([pdfs[index]], {type:'application/pdf'}));
        pdfUrls.push(url);
        link.href = url;
        const preview = document.createElement('object');
        preview.type = 'application/pdf';
        preview.data = url;
        preview.setAttribute('aria-label', link.textContent);
        preview.textContent = 'Utilise le lien ci-dessus pour lire la tablature.';
        link.after(preview);
      }
      select(0);
      update(0);
      player.hidden = false;
      status.textContent = 'Les deux versions sont prêtes.';
    } catch {
      status.textContent = 'Ce fichier de comparaison est illisible. Sélectionne le fichier JSON fourni par SongToSheet.';
    } finally {
      input.disabled = false;
      input.value = '';
    }
  };

  async function checkSession() {
    try {
      const response = await fetch('/api/auth/me', {cache:'no-store'});
      if (!response.ok) throw new Error();
      const {user} = await response.json();
      if (user?.role === 'admin') {
        status.textContent = '';
        get('import').hidden = false;
      } else {
        status.textContent = 'Connecte-toi avec ton compte admin pour ouvrir le comparatif.';
      }
    } catch {
      status.textContent = 'La session n’a pas pu être vérifiée. Recharge la page.';
    }
  }
  checkSession();
})();
