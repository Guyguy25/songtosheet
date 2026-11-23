// Blog Tablurio : hub /apprendre (FR) et /en/learn (EN) + articles.
// Ajouter un article : une entrée dans ARTICLES (fr + en), puis `node dev/build-seo-pages.mjs`.

const tab = lines => `<pre class="sp-tab" aria-label="Tablature">${lines.join('\n')}</pre>`;

export const HUBS = {
  fr: {
    path: 'apprendre', alt: 'en/learn', nav: 'Apprendre',
    title: 'Apprendre la musique : guides guitare, piano et solfège | Tablurio',
    description: 'Guides pratiques pour lire une tablature, une partition et apprendre tes morceaux préférés à la guitare ou au piano. Par Tablurio.',
    kicker: '📚 Apprendre', h1: 'Apprends à lire <em>et à jouer</em> tes morceaux.',
    lead: 'Des guides clairs pour lire une tablature ou une partition, et passer plus vite du morceau que tu écoutes au morceau que tu joues.',
    listTitle: 'Les guides', readLabel: 'Lire le guide →', minutes: 'min de lecture',
    soonTitle: 'Bientôt', soon: ['Partition ou tablature : laquelle choisir ?', 'Morceaux faciles à la guitare pour débutant', 'Relever un morceau à l’oreille (et comment l’IA le fait)'],
  },
  en: {
    path: 'en/learn', alt: 'apprendre', nav: 'Learn',
    title: 'Learn music: guitar, piano and music reading guides | Tablurio',
    description: 'Practical guides to read guitar tabs and sheet music, and learn your favourite songs on guitar or piano. By Tablurio.',
    kicker: '📚 Learn', h1: 'Learn to read <em>and play</em> your songs.',
    lead: 'Clear guides to read tabs and sheet music, and get from the song you listen to, to the song you play, faster.',
    listTitle: 'Guides', readLabel: 'Read the guide →', minutes: 'min read',
    soonTitle: 'Coming soon', soon: ['Sheet music or tab: which one should you pick?', 'Easy guitar songs for beginners', 'Learning a song by ear (and how AI does it)'],
  },
};

export const ARTICLES = [
  {
    id: 'lire-tablature',
    date: '2026-11-23',
    minutes: 8,
    fr: {
      slug: 'lire-une-tablature-guitare',
      title: 'Comment lire une tablature guitare : le guide complet pour débutants | Tablurio',
      description: 'Apprends à lire une tablature guitare en 10 minutes : les 6 lignes, les chiffres, les accords, les symboles (h, p, /, b, x, PM) et le rythme, avec des exemples.',
      nav: 'Lire une tablature guitare',
      h1: 'Comment lire une <em>tablature guitare</em>',
      lead: 'Les 6 lignes, les chiffres, les accords, les symboles et le rythme : tout ce qu’il faut pour lire une tab et jouer ton premier morceau, même sans connaître le solfège.',
      teaser: 'Les 6 lignes, les chiffres, les accords et tous les symboles, expliqués simplement avec des exemples.',
      toc: 'Au sommaire',
      body: [
        ['C’est quoi, une tablature ?', `<p>La <strong>tablature</strong> (ou « tab ») est une façon d’écrire la musique pensée pour les instruments à cordes. Au lieu de te dire <em>quelle note</em> jouer, comme une partition, elle te dit <strong>où poser tes doigts</strong> : sur quelle corde et sur quelle case.</p>
<p>C’est pour ça qu’elle est si populaire chez les guitaristes autodidactes : pas besoin de savoir lire le solfège pour s’en servir. En quelques minutes, tu peux jouer un riff que tu aurais mis des heures à retrouver à l’oreille.</p>`],
        ['Les 6 lignes = les 6 cordes', `<p>Une tablature de guitare a <strong>6 lignes horizontales</strong>, une par corde. Le piège classique : elles sont dans l’ordre <strong>inverse</strong> de ce que tu vois en regardant ta guitare.</p>
<ul><li>La ligne du <strong>haut</strong> = la corde la plus <strong>fine</strong>, le mi aigu (e).</li>
<li>La ligne du <strong>bas</strong> = la corde la plus <strong>grosse</strong>, le mi grave (E).</li></ul>
<p>Pense-y comme à la hauteur du son : en haut les notes aiguës, en bas les notes graves. En accordage standard, de haut en bas :</p>
${tab(['e|-----------', 'B|-----------', 'G|-----------', 'D|-----------', 'A|-----------', 'E|-----------'])}
<p>Les lettres à gauche rappellent le nom de chaque corde : mi, si, sol, ré, la, mi.</p>`],
        ['Les chiffres = les cases', `<p>Chaque <strong>chiffre</strong> posé sur une ligne indique la <strong>case</strong> à appuyer sur cette corde :</p>
<ul><li><strong>0</strong> : corde à vide, tu la joues sans appuyer sur aucune case.</li>
<li><strong>3</strong> : tu appuies sur la 3e case.</li>
<li><strong>12</strong> : la 12e case (c’est bien un seul nombre, pas 1 puis 2).</li>
<li><strong>x</strong> : note étouffée, un son percussif sans hauteur.</li></ul>
<p>Exemple : la ligne ci-dessous te demande de jouer la corde de la (A) à vide, puis à la 2e case, puis à la 3e.</p>
${tab(['e|-----------', 'B|-----------', 'G|-----------', 'D|-----------', 'A|--0--2--3--', 'E|-----------'])}`],
        ['Lire de gauche à droite : notes seules et accords', `<p>Une tablature se lit <strong>de gauche à droite</strong>, comme un texte. Deux règles suffisent :</p>
<ul><li>Des chiffres <strong>décalés</strong> se jouent <strong>l’un après l’autre</strong> (une mélodie, un riff, un arpège).</li>
<li>Des chiffres <strong>alignés verticalement</strong> se jouent <strong>en même temps</strong> : c’est un accord.</li></ul>
<p>Voici l’accord de <strong>do majeur</strong> (C), d’abord gratté d’un coup, puis joué note par note en arpège :</p>
${tab(['e|--0-----------0--', 'B|--1---------1----', 'G|--0-------0------', 'D|--2-----2--------', 'A|--3---3----------', 'E|--x--------------'])}
<p>Le <strong>x</strong> sur la corde de mi grave signifie qu’on ne la joue pas, ou qu’on l’étouffe.</p>`],
        ['Les symboles à connaître', `<p>Les tabs ajoutent des lettres et des signes pour les techniques de jeu. Les plus courants :</p>
<ul><li><strong>h</strong> (hammer-on) : <code>5h7</code>, tu joues la case 5 puis tu « frappes » la case 7 avec un autre doigt, sans regratter.</li>
<li><strong>p</strong> (pull-off) : <code>7p5</code>, l’inverse : tu retires le doigt de la case 7 pour faire sonner la case 5.</li>
<li><strong>/</strong> et <strong>\\</strong> (slide) : <code>5/7</code>, tu fais glisser le doigt de la case 5 jusqu’à la 7 sans le lever.</li>
<li><strong>b</strong> (bend) : <code>7b9</code>, tu tires la corde pour monter le son de la case 7 jusqu’à celui de la 9.</li>
<li><strong>~</strong> (vibrato) : tu fais onduler la note.</li>
<li><strong>PM</strong> (palm mute) : tu poses la tranche de la main sur les cordes près du chevalet pour un son étouffé.</li>
<li><strong>&lt;12&gt;</strong> : harmonique naturelle, tu effleures la corde au-dessus de la 12e frette sans appuyer.</li></ul>
<p>Pas de panique : tu n’en as pas besoin pour débuter. Apprends-les quand tu les croises dans un morceau.</p>`],
        ['Et le rythme ?', `<p>C’est la grande limite de la tablature : un espacement ne dit pas exactement <strong>combien de temps</strong> tenir une note. Les tabs écrites à la main sur Internet indiquent rarement le rythme précis.</p>
<p>Trois solutions :</p>
<ul><li><strong>Écouter le morceau</strong> en suivant la tab, pour caler le rythme à l’oreille.</li>
<li>Utiliser une tab <strong>avec rythme</strong> (au format Guitar Pro ou MusicXML), qui affiche aussi les durées.</li>
<li>Utiliser une tab <strong>synchronisée avec l’audio</strong> : sur Tablurio, la tablature générée se lit pendant que le morceau joue, et tu peux ralentir la lecture.</li></ul>`],
        ['Accordages et capodastre', `<p>La plupart des tabs sont écrites en <strong>accordage standard</strong> (mi la ré sol si mi). Si un morceau utilise un autre accordage, il est indiqué en haut de la tab, par exemple « Drop D » (le mi grave descendu en ré).</p>
<p>Si la tab mentionne un <strong>capo</strong> (par exemple « capo 2 »), les chiffres sont écrits <strong>par rapport au capodastre</strong> : un 0 désigne la case du capo, pas la corde à vide.</p>`],
        ['Les erreurs de débutant', `<ul><li><strong>Inverser les cordes</strong> : la ligne du haut est la corde la plus fine, pas la plus grosse.</li>
<li><strong>Lire « 12 » comme 1 puis 2</strong> : un nombre à deux chiffres est une seule case.</li>
<li><strong>Jouer trop vite</strong> : commence lentement, avec la bonne position, puis accélère.</li>
<li><strong>Ignorer l’écoute</strong> : la tab te dit où jouer, le morceau te dit comment le jouer.</li></ul>`],
        ['Passer à la pratique', `<p>Le meilleur moyen de progresser, c’est de lire des tabs <strong>de morceaux que tu aimes</strong>. Si la tab que tu cherches n’existe pas, tu peux la générer : colle un lien YouTube, Spotify ou Deezer dans le <a href="/tablature-guitare">générateur de tablature guitare</a> de Tablurio et tu obtiens la tab du morceau, avec la lecture audio synchronisée.</p>
<p>Dans les tabs générées par Tablurio, les chiffres alignés se jouent ensemble, les chiffres décalés un par un, <strong>sl.</strong> indique un slide et <strong>P</strong> un pull-off.</p>`],
      ],
      faq: [
        ['Faut-il connaître le solfège pour lire une tablature ?', 'Non. La tablature indique la corde et la case à jouer : c’est justement ce qui la rend accessible sans solfège. Le rythme, lui, s’apprend surtout à l’oreille.'],
        ['Dans une tablature, quelle ligne est la corde de mi grave ?', 'La ligne du bas. La ligne du haut est la corde la plus fine, le mi aigu.'],
        ['Que veut dire 0 dans une tab ?', 'La corde est jouée à vide, sans appuyer sur aucune case.'],
        ['Comment obtenir la tablature d’un morceau introuvable ?', 'Tu peux la générer avec un outil comme Tablurio : colle le lien YouTube, Spotify ou Deezer du morceau, choisis la guitare et la tablature, et récupère la tab.'],
      ],
      ctaTitle: 'La tab de ton morceau préféré, en une minute', ctaText: 'Colle un lien et récupère la tablature. 3 aperçus gratuits de 30 secondes.', ctaBtn: 'Générer une tablature ↗', ctaHref: '/tablature-guitare',
    },
    en: {
      slug: 'how-to-read-guitar-tabs',
      title: 'How to read guitar tabs: the complete beginner’s guide | Tablurio',
      description: 'Learn to read guitar tabs in 10 minutes: the 6 lines, the numbers, chords, symbols (h, p, /, b, x, PM) and rhythm, with examples.',
      nav: 'How to read guitar tabs',
      h1: 'How to read <em>guitar tabs</em>',
      lead: 'The 6 lines, the numbers, chords, symbols and rhythm: everything you need to read a tab and play your first song, even if you can’t read music.',
      teaser: 'The 6 lines, the numbers, chords and every symbol, explained simply with examples.',
      toc: 'Contents',
      body: [
        ['What is a tab?', `<p><strong>Tablature</strong> (or “tab”) is a way of writing music designed for string instruments. Instead of telling you <em>which note</em> to play, like sheet music, it tells you <strong>where to put your fingers</strong>: which string and which fret.</p>
<p>That’s why self-taught guitarists love it: you don’t need to read music to use it. In a few minutes, you can play a riff that would have taken hours to work out by ear.</p>`],
        ['6 lines = 6 strings', `<p>A guitar tab has <strong>6 horizontal lines</strong>, one per string. The classic trap: they’re in the <strong>opposite</strong> order to what you see when you look down at your guitar.</p>
<ul><li>The <strong>top</strong> line = the <strong>thinnest</strong> string, high E (e).</li>
<li>The <strong>bottom</strong> line = the <strong>thickest</strong> string, low E (E).</li></ul>
<p>Think of pitch: high notes at the top, low notes at the bottom. In standard tuning, from top to bottom:</p>
${tab(['e|-----------', 'B|-----------', 'G|-----------', 'D|-----------', 'A|-----------', 'E|-----------'])}`],
        ['Numbers = frets', `<p>Each <strong>number</strong> on a line tells you which <strong>fret</strong> to press on that string:</p>
<ul><li><strong>0</strong>: open string, played without pressing any fret.</li>
<li><strong>3</strong>: press the 3rd fret.</li>
<li><strong>12</strong>: the 12th fret (one number, not 1 then 2).</li>
<li><strong>x</strong>: muted note, a percussive sound with no pitch.</li></ul>
<p>Example: play the open A string, then the 2nd fret, then the 3rd.</p>
${tab(['e|-----------', 'B|-----------', 'G|-----------', 'D|-----------', 'A|--0--2--3--', 'E|-----------'])}`],
        ['Reading left to right: single notes and chords', `<p>A tab reads <strong>left to right</strong>, like text. Two rules are enough:</p>
<ul><li><strong>Staggered</strong> numbers are played <strong>one after another</strong> (a melody, a riff, an arpeggio).</li>
<li>Numbers <strong>stacked vertically</strong> are played <strong>together</strong>: that’s a chord.</li></ul>
<p>Here is a <strong>C major</strong> chord, first strummed, then played note by note as an arpeggio:</p>
${tab(['e|--0-----------0--', 'B|--1---------1----', 'G|--0-------0------', 'D|--2-----2--------', 'A|--3---3----------', 'E|--x--------------'])}
<p>The <strong>x</strong> on the low E string means you don’t play it, or you mute it.</p>`],
        ['Symbols to know', `<p>Tabs add letters and signs for playing techniques. The most common:</p>
<ul><li><strong>h</strong> (hammer-on): <code>5h7</code>, play fret 5 then “hammer” fret 7 with another finger, without picking again.</li>
<li><strong>p</strong> (pull-off): <code>7p5</code>, the reverse: pull your finger off fret 7 to sound fret 5.</li>
<li><strong>/</strong> and <strong>\\</strong> (slide): <code>5/7</code>, slide your finger from fret 5 to 7 without lifting it.</li>
<li><strong>b</strong> (bend): <code>7b9</code>, push the string to raise fret 7’s pitch up to fret 9’s.</li>
<li><strong>~</strong> (vibrato): make the note waver.</li>
<li><strong>PM</strong> (palm mute): rest the edge of your hand on the strings near the bridge for a muted sound.</li>
<li><strong>&lt;12&gt;</strong>: natural harmonic, lightly touch the string above the 12th fret without pressing.</li></ul>
<p>Don’t worry: you don’t need them to start. Learn them when you meet them in a song.</p>`],
        ['What about rhythm?', `<p>That’s the big limit of tabs: spacing doesn’t tell you exactly <strong>how long</strong> to hold a note. Hand-written tabs online rarely show precise rhythm.</p>
<ul><li><strong>Listen to the song</strong> while following the tab, to get the rhythm by ear.</li>
<li>Use a tab <strong>with rhythm</strong> (Guitar Pro or MusicXML), which also shows durations.</li>
<li>Use a tab <strong>synced with the audio</strong>: on Tablurio, the generated tab plays along with the song, and you can slow it down.</li></ul>`],
        ['Tunings and capo', `<p>Most tabs are written in <strong>standard tuning</strong> (E A D G B E). If a song uses another tuning, it’s shown at the top of the tab, for example “Drop D” (low E tuned down to D).</p>
<p>If the tab mentions a <strong>capo</strong> (for example “capo 2”), the numbers are written <strong>relative to the capo</strong>: a 0 means the capo fret, not the open string.</p>`],
        ['Beginner mistakes', `<ul><li><strong>Flipping the strings</strong>: the top line is the thinnest string, not the thickest.</li>
<li><strong>Reading “12” as 1 then 2</strong>: a two-digit number is a single fret.</li>
<li><strong>Playing too fast</strong>: start slowly with the right position, then speed up.</li>
<li><strong>Not listening</strong>: the tab tells you where to play, the song tells you how.</li></ul>`],
        ['Time to practise', `<p>The best way to improve is to read tabs <strong>of songs you love</strong>. If the tab you want doesn’t exist, generate it: paste a YouTube, Spotify or Deezer link into Tablurio’s <a href="/en/guitar-tab-generator">guitar tab generator</a> and get the song’s tab, with synced audio playback.</p>
<p>In tabs generated by Tablurio, stacked numbers are played together, staggered numbers one by one, <strong>sl.</strong> means slide and <strong>P</strong> means pull-off.</p>`],
      ],
      faq: [
        ['Do I need to read music to read tabs?', 'No. A tab shows the string and fret to play, which is exactly what makes it accessible without music theory. Rhythm is mostly learned by ear.'],
        ['Which line is the low E string in a tab?', 'The bottom line. The top line is the thinnest string, high E.'],
        ['What does 0 mean in a tab?', 'The string is played open, without pressing any fret.'],
        ['How do I get the tab of a song I can’t find?', 'Generate it with a tool like Tablurio: paste the song’s YouTube, Spotify or Deezer link, pick guitar and tab, and get the tab.'],
      ],
      ctaTitle: 'Your favourite song’s tab, in about a minute', ctaText: 'Paste a link and get the tab. 3 free 30-second previews.', ctaBtn: 'Generate a tab ↗', ctaHref: '/en/guitar-tab-generator',
    },
  },
];
