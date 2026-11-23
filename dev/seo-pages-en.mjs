// English versions of the Tablurio tool pages (served under /en/<slug>).
// `pair` = slug of the French page (used for hreflang). Keep facts aligned with the product.
export const PAGES_EN = [
  {
    slug: 'youtube-to-sheet-music', pair: 'youtube-en-partition',
    nav: 'YouTube to sheet music', teaser: 'Paste a YouTube link, get the notes',
    title: 'YouTube to Sheet Music Free: Turn Any Video into Sheet Music | Tablurio',
    description: 'Free online YouTube to sheet music converter: paste a video or Short link and get sheet music or tabs for guitar, piano or vocals. 3 free previews.',
    kicker: '▶ YouTube → sheet music',
    h1: 'Turn a YouTube video into <em>sheet music</em>',
    lead: 'Found the song on YouTube but not the sheet music? Paste the video link: Tablurio listens to the audio and gives you sheet music or a tab, ready to play. Try it free, no credit card.',
    placeholder: 'Paste a YouTube link (video or Short)…',
    visual: { label: 'Illustrative example', title: 'Piano sheet music', sub: 'From a YouTube link', svg: 'staff' },
    stepsTitle: 'From YouTube to sheet music in 3 steps',
    steps: [
      ['Paste the link', 'Copy the video URL from YouTube (desktop or app) and paste it above. Regular videos and Shorts both work.'],
      ['Pick your instrument', 'Guitar (sheet music or tab), piano or vocals. You can also choose which part of the song to transcribe.'],
      ['Play or export', 'Your sheet music shows on screen with synced audio playback. With a paid plan, export it to PDF, MIDI or MusicXML.'],
    ],
    proseTitle: 'Why start from YouTube?',
    prose: `<p>YouTube is the largest free music library in the world: studio versions, live shows, covers, acoustic takes, songs you can’t find anywhere else. The sheet music, on the other hand, often doesn’t exist… or is sold one song at a time.</p>
<p>With Tablurio, <strong>the video becomes the source of your sheet music</strong>. The AI analyses the audio, detects pitches and rhythm, then writes them on a staff or a tab depending on the instrument you picked.</p>
<h3>Which videos work best?</h3>
<ul><li><strong>Clean sound</strong>: a studio version or a good live recording beats a phone recording.</li>
<li><strong>A clear lead instrument</strong>: solo piano, acoustic guitar or upfront vocals make the transcription easier.</li>
<li><strong>Up to 10 minutes</strong>: longer links are refused, but you can pick the excerpt you want.</li></ul>
<p>On very dense arrangements (orchestras, walls of distorted guitars), a few passages may need a touch-up. That’s exactly what the MIDI and MusicXML exports are for: fix it in a few clicks in your favourite software.</p>
<p class="sp-note">Only use Tablurio for songs you’re allowed to transcribe, for example for your own practice. You confirm it with every generation.</p>`,
    faq: [
      ['Does Tablurio work with YouTube Shorts?', 'Yes. Regular video links (youtube.com/watch), short links (youtu.be) and Shorts are all accepted.'],
      ['How long does it take?', 'Usually around thirty seconds to a minute, depending on the length of the excerpt and server load.'],
      ['Is it free?', 'Your free account includes 3 previews of 30 seconds to judge the result on your own songs. Full songs and exports come with the Starter, Pro and Lifetime plans.'],
      ['What is the maximum video length?', '10 minutes of audio per generation. For longer songs, pick the excerpt you want to practise.'],
      ['Is the sheet music 100% accurate?', 'No, it’s an automatic transcription. It gets the vast majority of notes right, but a very busy passage may need a touch-up. Always check the result before playing.'],
      ['Is Tablurio available in English?', 'Yes. Pick EN in the top-right corner: your choice is remembered, and the generation, sign-up and your studio stay in English.'],
    ],
  },
  {
    slug: 'guitar-tab-generator', pair: 'tablature-guitare', instrument: 'guitare',
    nav: 'Guitar tab generator', teaser: 'Guitar tabs for any song',
    title: 'Guitar Tab Generator & Maker: Get Tabs from Any Song | Tablurio',
    description: 'Online guitar tab maker that writes the tab for you: paste a YouTube, Spotify or Deezer link or upload audio, get the tab of any song or riff. Try it free.',
    kicker: '🎸 Guitar tabs',
    h1: '<em>Guitar tab generator</em> for any song',
    lead: 'No more hunting for a tab that doesn’t exist or spending hours learning by ear. Paste the song link, pick guitar, and get your tab.',
    placeholder: 'Paste the song link (YouTube, Spotify, Deezer)…',
    visual: { label: 'Illustrative example', title: 'Guitar tab', sub: 'Standard tuning', svg: 'tab' },
    stepsTitle: 'Your guitar tab in 3 steps',
    steps: [
      ['Add your song', 'Paste a YouTube, Spotify or Deezer link, or upload an audio file (MP3, WAV, M4A, FLAC).'],
      ['Choose guitar, then tab', 'You can also ask for standard notation if you read music.'],
      ['Play along', 'Follow the tab on screen while the song plays, then export it to PDF, MIDI or MusicXML with a paid plan.'],
    ],
    proseTitle: 'Tab or standard notation?',
    prose: `<p><strong>Tablature</strong> is the guitarist’s favourite notation: each of the six lines is a string, and each number tells you which fret to play. You don’t need to read music to use it, which is why self-taught players love it.</p>
<p><strong>Standard notation</strong> gives the exact pitch and rhythm of every note on a staff. It’s more precise for rhythm and easy to share with other musicians.</p>
<p>On Tablurio you don’t have to choose once and for all: for guitar, you ask for a tab or sheet music depending on what you prefer to read.</p>
<h3>How to read the generated tab</h3>
<ul><li>The <strong>top</strong> line is the high E string, the <strong>bottom</strong> line the low E string.</li>
<li>A <strong>0</strong> means open string, a <strong>3</strong> means 3rd fret.</li>
<li>Numbers stacked vertically are played together (a chord).</li></ul>
<h3>Which songs?</h3>
<p>Riffs, arpeggios, melodies, acoustic intros: transcription is most reliable when the guitar or melody stands out in the mix. On very busy songs some passages may need a touch-up, which you can do in Guitar Pro or MuseScore thanks to the MusicXML export.</p>
<h3>A tab maker that does the writing for you</h3>
<p>Most online <strong>tab makers</strong> and <strong>tab creators</strong> give you an empty grid and let you type every number yourself. Tablurio works the other way round: you bring the song, and it writes the tab. It’s handy for a <strong>guitar riff</strong> you want to learn, an intro, a solo or a whole song, and you can then fine-tune the result in Guitar Pro or MuseScore.</p>
<p>Play bass? 4-string bass tabs are in beta and coming soon.</p>`,
    faq: [
      ['Can I use it as a guitar riff maker?', 'Yes. Upload a recording of a riff, or paste the link of a song and pick the excerpt you want: Tablurio writes the tab of that passage.'],
      ['Is the tab generator free?', 'You get 3 free previews of 30 seconds to try it on your own songs. Full songs and exports come with Starter (€10/month), Pro (€19/month) and Lifetime (€99 once).'],
      ['Can I get standard notation instead of a tab?', 'Yes. For guitar, you choose between tab and standard notation.'],
      ['Which tuning is used?', 'Tabs are written for a 6-string guitar in standard tuning (E A D G B E).'],
      ['Can I open the tab in Guitar Pro or MuseScore?', 'Yes, export it to MusicXML, the exchange format supported by most notation software, including MuseScore and Guitar Pro.'],
      ['Does it work with my own recording?', 'Yes. Upload your MP3, WAV, M4A or FLAC file (25 MB max) instead of pasting a link.'],
      ['What about bass?', '4-string bass tabs are in beta and will be available when the beta ends.'],
    ],
  },
  {
    slug: 'piano-sheet-music', pair: 'partition-piano', instrument: 'piano',
    nav: 'Piano sheet music from a song', teaser: 'Piano sheet music for your songs',
    title: 'Piano Sheet Music from Any Song (Link or Audio) | Tablurio',
    description: 'Get piano sheet music for a song from a YouTube, Spotify or Deezer link, or from an audio file. Synced playback, export to PDF, MIDI and MusicXML.',
    kicker: '🎹 Piano sheet music',
    h1: '<em>Piano sheet music</em> for any song',
    lead: 'The song you want to play has no piano sheet music, or it costs too much for a song you’ll play for two weeks? Paste the link and Tablurio writes the notes.',
    placeholder: 'Paste the song link (YouTube, Spotify, Deezer)…',
    visual: { label: 'Illustrative example', title: 'Piano sheet music', sub: 'Layout example', svg: 'staff' },
    stepsTitle: 'Your piano sheet music in 3 steps',
    steps: [
      ['Add the song', 'A YouTube, Spotify or Deezer link, or your own audio file.'],
      ['Choose piano', 'Optionally pick the excerpt to transcribe (up to 10 minutes).'],
      ['Play, print or edit', 'Read the sheet music with synced audio, then export to PDF to print, or MIDI / MusicXML to edit.'],
    ],
    proseTitle: 'Piano sheet music without buying song by song',
    prose: `<p>On sheet music stores, every song is sold separately, and recent or lesser-known tracks are often missing. Tablurio flips the problem around: <strong>you start from the audio</strong>, and the AI writes the sheet music.</p>
<h3>What you get</h3>
<ul><li><strong>Sheet music on a staff</strong>, readable on screen, with audio playback to check by ear.</li>
<li><strong>A PDF</strong> to print and put on your music stand.</li>
<li><strong>A MIDI file</strong> to play back on a digital piano, in Synthesia or in your DAW.</li>
<li><strong>A MusicXML file</strong> to open and edit in MuseScore, Dorico or Sibelius.</li></ul>
<h3>Tips for better results</h3>
<p>Solo piano versions, piano covers and songs where the piano sits upfront give the cleanest results. On songs with lots of instruments, the transcription focuses on what stands out most; a very dense passage may need a touch-up, easy to do with MusicXML.</p>
<p>Beginner? Start with a short excerpt, play it slowly with the audio, then move on.</p>`,
    faq: [
      ['Can I get piano sheet music for a pop song?', 'Yes, from any song available on YouTube, Spotify or Deezer, or from an audio file. Results are cleaner when the piano or melody stands out.'],
      ['Is it free?', 'You get 3 free previews of 30 seconds. Full songs, PDF, MIDI and MusicXML come with the Starter, Pro and Lifetime plans.'],
      ['Can I print it?', 'Yes, export it to PDF.'],
      ['Can I edit the notes?', 'Yes: export to MusicXML for MuseScore, Dorico or Sibelius, or to MIDI for your DAW.'],
      ['How long does it take?', 'Usually around thirty seconds to a minute, depending on the excerpt length.'],
      ['Is the transcription perfect?', 'It’s an automatic transcription: accurate on the vast majority of notes, but always check the result, especially on busy passages.'],
    ],
  },
  {
    slug: 'mp3-to-sheet-music', pair: 'mp3-en-partition', upload: true,
    nav: 'MP3 to sheet music', teaser: 'Upload an audio file, get the notes',
    title: 'MP3 to Sheet Music Converter (WAV, M4A, FLAC too) | Tablurio',
    description: 'Convert an MP3, WAV, M4A or FLAC file into sheet music or tabs for guitar, piano or vocals. Up to 25 MB and 10 minutes. Export to PDF, MIDI, MusicXML.',
    kicker: '⇧ Audio → sheet music',
    h1: 'Convert <em>MP3 to sheet music</em>',
    lead: 'A rehearsal recording, a demo, a song you bought as an MP3? Upload the audio file and Tablurio turns it into sheet music or a tab.',
    placeholder: 'Or paste a YouTube, Spotify, Deezer link…',
    visual: { label: 'Illustrative example', title: 'Sheet music', sub: 'From an MP3 file', svg: 'staff' },
    stepsTitle: 'From audio file to sheet music',
    steps: [
      ['Upload your file', 'MP3, WAV, M4A or FLAC, up to 25 MB and 10 minutes of audio.'],
      ['Pick your instrument', 'Guitar (sheet music or tab), piano or vocals.'],
      ['Get your notes', 'Sheet music on screen with audio playback, then export to PDF, MIDI or MusicXML with a paid plan.'],
    ],
    proseTitle: 'Why convert a file rather than a link?',
    prose: `<p>Not every song is on YouTube. Your own compositions, a lesson recording, your band’s demo or a file bought from an online store: <strong>file upload</strong> lets you transcribe exactly the audio you have.</p>
<h3>Supported formats</h3>
<ul><li><strong>MP3</strong>: the most common, perfect for most uses.</li>
<li><strong>WAV</strong> and <strong>FLAC</strong>: lossless, ideal for demos and quality recordings.</li>
<li><strong>M4A</strong>: the format of iPhone voice memos and many downloads.</li></ul>
<p>Maximum size: 25 MB per file, and 10 minutes of audio per generation.</p>
<h3>Prepare your recording</h3>
<p>The cleaner the instrument, the better the result: avoid background noise, record close to the source, and trim long silences. A voice memo of you humming a melody can also become vocal sheet music.</p>
<p class="sp-note">Only upload recordings you have the right to transcribe (your compositions, your own practice…).</p>`,
    faq: [
      ['Which audio formats are supported?', 'MP3, WAV, M4A and FLAC, up to 25 MB.'],
      ['Is there a length limit?', 'Yes, 10 minutes of audio per generation.'],
      ['Can I convert a voice memo from my phone?', 'Yes. iPhone voice memos are M4A, a supported format. Choose “Vocals” to get the vocal line as sheet music.'],
      ['Is the conversion free?', 'You get 3 free previews of 30 seconds. Full songs and exports come with the Starter, Pro and Lifetime plans.'],
      ['Can I convert MP3 to MIDI?', 'Yes: once the sheet music is generated, export it to MIDI with a paid plan.'],
    ],
  },
  {
    slug: 'spotify-to-sheet-music', pair: 'spotify-en-partition',
    nav: 'Spotify to sheet music', teaser: 'A Spotify track becomes sheet music',
    title: 'Spotify to Sheet Music: Sheet Music from a Spotify Track | Tablurio',
    description: 'Paste a Spotify track link and get its sheet music or tab for guitar, piano or vocals. Tablurio finds the song and transcribes the notes.',
    kicker: '◉ Spotify → sheet music',
    h1: 'From <em>Spotify</em> to sheet music',
    lead: 'Been playing that song on repeat on Spotify and want to finally play it yourself? Paste the track link: Tablurio finds the song and writes its sheet music or tab.',
    placeholder: 'Paste a Spotify track link…',
    visual: { label: 'Illustrative example', title: 'Guitar tab', sub: 'From a Spotify track', svg: 'tab' },
    stepsTitle: 'How it works with Spotify',
    steps: [
      ['Copy the track link', 'In Spotify, open the “…” menu of the song, then Share › Copy song link.'],
      ['Check the suggested version', 'Spotify audio is protected: Tablurio finds the same song on YouTube and suggests the version to use, with alternatives.'],
      ['Pick your instrument', 'Guitar, piano or vocals, then read your sheet music with audio playback and export it.'],
    ],
    proseTitle: 'Why Tablurio goes through YouTube',
    prose: `<p>Spotify doesn’t let anyone retrieve the audio of its tracks. Instead of blocking you, Tablurio uses the Spotify link to <strong>identify the song</strong> (title, artist), then looks for the same song on YouTube. You see the version found before the transcription starts, and can choose another one if it’s not right (live, remix, cover…).</p>
<p>If the song can’t be found, paste a YouTube link directly or upload your own audio file.</p>
<h3>Which Spotify links work?</h3>
<ul><li><strong>Track links</strong> (open.spotify.com/track/…): yes.</li>
<li>Playlists, albums and podcasts: no, pick a specific track.</li></ul>`,
    faq: [
      ['Does Tablurio download audio from Spotify?', 'No. The Spotify link is used to identify the song; Tablurio then finds the same song on YouTube and suggests the version to use.'],
      ['What if the suggested version is wrong?', 'Pick one of the alternatives, or paste the YouTube link of the version you want.'],
      ['Can I paste a playlist link?', 'No, paste the link of a specific track.'],
      ['Is it free?', 'You get 3 free previews of 30 seconds. Full songs and exports come with the Starter, Pro and Lifetime plans.'],
      ['Which instruments are available?', 'Guitar (sheet music or tab), piano and vocals. Bass is in beta; violin and drums are coming soon.'],
    ],
  },
  {
    slug: 'deezer-to-sheet-music', pair: 'deezer-en-partition',
    nav: 'Deezer to sheet music', teaser: 'A Deezer track becomes sheet music',
    title: 'Deezer to Sheet Music: Sheet Music from a Deezer Track | Tablurio',
    description: 'Paste a Deezer track link and get its sheet music or tab for guitar, piano or vocals. Tablurio finds the song and transcribes the notes.',
    kicker: '▥ Deezer → sheet music',
    h1: 'From <em>Deezer</em> to sheet music',
    lead: 'A track from your Deezer library you’d love to play? Paste its link: Tablurio finds the song and turns it into sheet music or a tab.',
    placeholder: 'Paste a Deezer track link…',
    visual: { label: 'Illustrative example', title: 'Piano sheet music', sub: 'From a Deezer track', svg: 'staff' },
    stepsTitle: 'How it works with Deezer',
    steps: [
      ['Copy the track link', 'In Deezer, open the song menu, then Share › Copy link.'],
      ['Check the version', 'Tablurio finds the same song on YouTube and suggests the version to use. If none is found, Deezer’s official 30-second preview can be used as a fallback.'],
      ['Pick your instrument', 'Guitar, piano or vocals, then read your sheet music and export it.'],
    ],
    proseTitle: 'Deezer, YouTube and the 30-second preview',
    prose: `<p>The full audio of Deezer tracks is protected. Tablurio uses your link to <strong>identify the song</strong>, then looks for the same song on YouTube. You confirm the version found (or an alternative) before the transcription starts.</p>
<p>If the song isn’t on YouTube, Tablurio can use Deezer’s <strong>official 30-second preview</strong> when it’s available. For the full song, paste a YouTube link or upload your audio file.</p>
<h3>Which Deezer links work?</h3>
<ul><li><strong>Track links</strong> (deezer.com/track/… or share links): yes.</li>
<li>Playlists, albums and Flow: no, pick a specific track.</li></ul>`,
    faq: [
      ['Does Tablurio download audio from Deezer?', 'No. The link is used to identify the song; Tablurio finds the same song on YouTube. Otherwise, Deezer’s official 30-second preview can be used.'],
      ['Can I transcribe a full song from Deezer?', 'Yes, as soon as the YouTube version is found. Otherwise, paste a YouTube link or upload your audio file.'],
      ['Can I paste an album or playlist link?', 'No, paste the link of a specific track.'],
      ['Is it free?', 'You get 3 free previews of 30 seconds. Full songs and exports come with the Starter, Pro and Lifetime plans.'],
      ['Which export formats?', 'PDF to read or print, MIDI and MusicXML to edit in your software.'],
    ],
  },
  {
    slug: 'musicxml', pair: 'musicxml',
    nav: 'MusicXML export', teaser: 'Open your sheet music in MuseScore, Dorico…',
    title: 'MusicXML Export: Open Your Sheet Music in MuseScore or Guitar Pro | Tablurio',
    description: 'What is MusicXML and what is it for? Generate sheet music from a song, then export it to MusicXML to edit in MuseScore, Dorico, Sibelius or Guitar Pro.',
    kicker: '♬ MusicXML format',
    h1: 'Your sheet music in <em>MusicXML</em>, ready to edit',
    lead: 'Generate sheet music or a tab from a song, then export it to MusicXML to fix, arrange or transpose it in your favourite notation software.',
    placeholder: 'Paste a song link (YouTube, Spotify, Deezer)…',
    visual: { label: 'File excerpt', title: 'MusicXML', sub: 'A tab note described in XML', code: true },
    stepsTitle: 'Getting a MusicXML file',
    steps: [
      ['Generate your sheet music', 'From a YouTube, Spotify or Deezer link or an audio file, for guitar, piano or vocals.'],
      ['Export to MusicXML', 'Download the file from the sheet music screen (Starter, Pro and Lifetime plans).'],
      ['Open it in your software', 'MuseScore, Dorico, Sibelius, Guitar Pro and most notation editors import it.'],
    ],
    proseTitle: 'What is MusicXML?',
    prose: `<p><strong>MusicXML</strong> is an open format designed to exchange sheet music between programs. Unlike a PDF (a fixed image) or MIDI (played notes, no layout), it describes the score itself: notes, rhythms, bars, clefs, accidentals, and even strings and frets for a tab.</p>
<h3>Why export it?</h3>
<ul><li><strong>Fix</strong> a note or rhythm after the automatic transcription.</li>
<li><strong>Transpose</strong> the song to a key that suits your voice or instrument.</li>
<li><strong>Arrange</strong>: add fingerings, dynamics, a second part.</li>
<li><strong>Share</strong> the score with a teacher or your band, who’ll open it in their own software.</li></ul>
<h3>MusicXML, MIDI or PDF?</h3>
<p><strong>PDF</strong> is for reading and printing. <a href="/en/midi"><strong>MIDI</strong></a> is for playback and sound. <strong>MusicXML</strong> is for editing the score. With a Tablurio plan, you get all three.</p>`,
    faq: [
      ['Which software opens MusicXML?', 'Most score editors: MuseScore (free), Dorico, Sibelius, Guitar Pro, and many mobile apps.'],
      ['What’s the difference between MusicXML and MIDI?', 'MIDI describes played notes (pitch, duration, velocity), great for sound. MusicXML describes the written score (bars, clefs, tabs), great for notation.'],
      ['Is MusicXML export included in the free plan?', 'The free preview is read on screen. PDF, MIDI and MusicXML exports come with the Starter, Pro and Lifetime plans.'],
      ['Can I export a guitar tab to MusicXML?', 'Yes, and then open it in Guitar Pro or MuseScore to edit it.'],
    ],
  },
  {
    slug: 'midi', pair: 'midi',
    nav: 'MIDI export', teaser: 'A song’s notes as a MIDI file',
    title: 'Convert a Song to MIDI (YouTube, MP3…) | Tablurio',
    description: 'Turn a song into a MIDI file from a YouTube, Spotify or Deezer link or an audio file. For Synthesia, your keyboard, GarageBand, Logic, Ableton or FL Studio.',
    kicker: '♪ MIDI format',
    h1: 'Convert a song to a <em>MIDI file</em>',
    lead: 'Get the notes of a song as MIDI to play them on your keyboard, learn them in an app, or rework them in your DAW.',
    placeholder: 'Paste a song link (YouTube, Spotify, Deezer)…',
    visual: { label: 'Illustrative example', title: 'MIDI file', sub: 'Notes in a piano roll', svg: 'midi' },
    stepsTitle: 'Getting the MIDI of a song',
    steps: [
      ['Add the song', 'YouTube, Spotify or Deezer link, or an audio file (MP3, WAV, M4A, FLAC).'],
      ['Pick your instrument', 'Piano, guitar or vocals: the transcription adapts to the instrument.'],
      ['Export to MIDI', 'Download the .mid file from the sheet music screen (Starter, Pro and Lifetime plans).'],
    ],
    proseTitle: 'What is a MIDI file for?',
    prose: `<p>A <strong>MIDI</strong> file contains no sound: it contains <strong>instructions</strong> (which note, when, how long, how loud). Any virtual instrument or keyboard can then play them with whatever sound you like.</p>
<h3>What you can do with it</h3>
<ul><li><strong>Learn piano</strong> with an app that shows falling notes, like Synthesia.</li>
<li><strong>Produce</strong>: drop the MIDI into GarageBand, Logic Pro, Ableton Live or FL Studio and change the sound, tempo or key.</li>
<li><strong>Play it on your digital piano</strong> or synth.</li>
<li><strong>Fix notes</strong> in a piano roll before importing everything into notation software.</li></ul>
<h3>MIDI or MusicXML?</h3>
<p>MIDI is made for sound and production. If you want to edit the written score (bars, tab, layout), go for <a href="/en/musicxml"><strong>MusicXML</strong></a>. Good news: Tablurio plans include both, plus PDF.</p>`,
    faq: [
      ['How do I convert a YouTube video to MIDI?', 'Paste the video link, pick your instrument, let Tablurio generate the sheet music, then export it to MIDI.'],
      ['How do I convert an MP3 to MIDI?', 'Upload your MP3 (25 MB and 10 minutes max), generate the sheet music, then export it to MIDI.'],
      ['Does the MIDI file work in Synthesia?', 'Yes, Synthesia and most piano learning apps open MIDI files.'],
      ['Is MIDI export free?', 'The free preview is read on screen. PDF, MIDI and MusicXML exports come with the Starter, Pro and Lifetime plans.'],
      ['Does the MIDI include every instrument of the song?', 'No: it contains the transcription of the instrument you chose (piano, guitar or vocals).'],
    ],
  },
];
