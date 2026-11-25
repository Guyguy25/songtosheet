// English home page of Tablurio, served at /en (the French home is index.html at /).
// Same template as the tool pages (dev/build-seo-pages.mjs), with `home: true`.
export const HOME_EN = {
  home: true, slug: '', pair: '',
  nav: 'Tablurio', teaser: '',
  title: 'Tablurio: AI Sheet Music & Guitar Tab Generator from Any Song',
  description: 'Turn any song into sheet music or guitar tabs with AI: paste a YouTube, Spotify or Deezer link or upload an audio file. Guitar, piano, vocals. Try it free.',
  kicker: '✦ AI music transcription',
  h1: 'Turn any song into <em>sheet music</em> or guitar tabs',
  lead: 'Paste a YouTube, Spotify or Deezer link, or upload an audio file. Tablurio listens to the song and writes the sheet music or tab for guitar, piano or vocals, in about a minute.',
  placeholder: 'Paste a YouTube, Spotify or Deezer link…',
  visual: { label: 'Illustrative example', title: 'Guitar tab', sub: 'From a YouTube link', svg: 'tab' },
  stepsTitle: 'From the song you hear to the song you play',
  steps: [
    ['Add your song', 'Paste a YouTube (video or Short), Spotify or Deezer link, or upload an MP3, WAV, M4A or FLAC file (25 MB and 10 minutes max).'],
    ['Pick your instrument', 'Guitar (tab or standard notation), piano or vocals. Bass tabs are in beta. Choose the part of the song you want.'],
    ['Play, slow down, export', 'Read along while the song plays, slow it down, then export to PDF, MIDI or MusicXML with a paid plan.'],
  ],
  proseTitle: 'What is Tablurio?',
  prose: `<p>Sheet music is usually sold one song at a time, and many songs simply don’t have any. <strong>Tablurio starts from the music instead.</strong> Its AI analyses the audio, detects pitches and rhythm, and writes them as a tab or on a staff, depending on the instrument you picked.</p>
<p>Several transcription engines each produce a version, and Tablurio recommends the one closest to the song. You get synced audio playback with adjustable speed, so you can practise a passage slowly before playing it at full tempo.</p>
<h3>What can you transcribe?</h3>
<ul><li><strong>Guitar</strong>: <a href="/en/guitar-tab-generator">guitar tabs</a> or standard notation, for riffs, intros, solos or whole songs.</li>
<li><strong>Piano</strong>: <a href="/en/piano-sheet-music">piano sheet music</a> on two staves.</li>
<li><strong>Vocals</strong>: the sung melody on a staff.</li></ul>
<h3>Where can the song come from?</h3>
<ul><li>A <a href="/en/youtube-to-sheet-music">YouTube video</a>, including Shorts.</li>
<li>A <a href="/en/spotify-to-sheet-music">Spotify</a> or <a href="/en/deezer-to-sheet-music">Deezer</a> track: Tablurio identifies the song and finds it on YouTube.</li>
<li>Your own <a href="/en/mp3-to-sheet-music">audio file</a>: MP3, WAV, M4A or FLAC.</li></ul>
<p>Exports: PDF to print, <a href="/en/midi">MIDI</a> for your music software, and <a href="/en/musicxml">MusicXML</a> to edit in MuseScore, Guitar Pro, Dorico or Sibelius.</p>
<p class="sp-note">It’s an automatic transcription: it gets most notes right, but a very busy passage may need a touch-up. Only transcribe songs you’re allowed to, for example for your own practice.</p>`,
  faq: [
    ['Is Tablurio free?', 'Your free account includes 3 previews of 30 seconds to judge the result on your own songs. Full songs and exports come with Starter (€10/month), Pro (€19/month) or Lifetime (€99 once).'],
    ['Which instruments are supported?', 'Guitar (tab or standard notation), piano and vocals. Bass tabs are in beta.'],
    ['Which links work?', 'YouTube videos and Shorts, Spotify and Deezer tracks. You can also upload an MP3, WAV, M4A or FLAC file.'],
    ['How long does a transcription take?', 'Usually thirty seconds to a minute, depending on the length of the excerpt.'],
    ['How accurate is it?', 'It gets the vast majority of notes right on songs where the instrument is clearly audible. Very dense mixes may need a touch-up, which the MusicXML export makes easy.'],
    ['Is the app available in English?', 'Yes. The whole app, from generation to your account, is in English. Your choice is remembered with the EN / FR switch at the top of the page.'],
  ],
};
