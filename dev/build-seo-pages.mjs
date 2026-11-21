// Génère les pages outils SEO statiques de Tablurio dans /outils/<slug>.html.
// Lancer : node dev/build-seo-pages.mjs  (puis committer les fichiers générés)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://tablurio.com';
const OUT = join(ROOT, 'outils');
const TODAY = '2026-11-21';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = s => String(s).replace(/<[^>]+>/g, '');

// ---------- Illustrations (exemples illustratifs, pas des transcriptions réelles) ----------
const tabSvg = () => `<svg viewBox="0 0 520 150" role="img" aria-label="Exemple illustratif de tablature guitare à six cordes">
  <g stroke="#c9c2dc" stroke-width="1.3">${[0,1,2,3,4,5].map(i=>`<line x1="40" y1="${22+i*20}" x2="505" y2="${22+i*20}"/>`).join('')}</g>
  <line x1="40" y1="22" x2="40" y2="122" stroke="#211c35" stroke-width="2"/><line x1="272" y1="22" x2="272" y2="122" stroke="#211c35" stroke-width="1.5"/><line x1="505" y1="22" x2="505" y2="122" stroke="#211c35" stroke-width="2.5"/>
  <text x="14" y="50" font-size="15" font-weight="800" fill="#211c35">T</text><text x="14" y="74" font-size="15" font-weight="800" fill="#211c35">A</text><text x="14" y="98" font-size="15" font-weight="800" fill="#211c35">B</text>
  <g font-size="15" font-weight="800" fill="#6136d0" text-anchor="middle">
    <text x="78" y="127">3</text><text x="112" y="87">2</text><text x="146" y="67">0</text><text x="180" y="47">1</text><text x="214" y="27">0</text><text x="246" y="47">1</text>
    <text x="304" y="107">0</text><text x="338" y="87">2</text><text x="372" y="67">2</text><text x="406" y="47">1</text><text x="440" y="27">0</text><text x="474" y="47">1</text>
  </g></svg>`;

const staffSvg = () => `<svg viewBox="0 0 520 170" role="img" aria-label="Exemple illustratif de partition sur portée">
  <g stroke="#c9c2dc" stroke-width="1.3">${[0,1,2,3,4].map(i=>`<line x1="20" y1="${30+i*12}" x2="505" y2="${30+i*12}"/>`).join('')}${[0,1,2,3,4].map(i=>`<line x1="20" y1="${108+i*12}" x2="505" y2="${108+i*12}"/>`).join('')}</g>
  <text x="26" y="84" font-size="58" fill="#211c35">𝄞</text><text x="28" y="146" font-size="40" fill="#211c35">𝄢</text>
  <g fill="#211c35">${[[100,72],[150,66],[200,60],[250,54],[310,60],[360,66],[410,72],[460,60]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx="7" ry="5.2" transform="rotate(-20 ${x} ${y})"/><line x1="${x+6}" y1="${y}" x2="${x+6}" y2="${y-34}" stroke="#211c35" stroke-width="1.6"/>`).join('')}
  ${[[100,138],[200,132],[310,138],[410,126]].map(([x,y])=>`<ellipse cx="${x}" cy="${y}" rx="7" ry="5.2" transform="rotate(-20 ${x} ${y})"/><line x1="${x-6}" y1="${y}" x2="${x-6}" y2="${y+32}" stroke="#211c35" stroke-width="1.6"/>`).join('')}</g>
  <line x1="272" y1="30" x2="272" y2="156" stroke="#211c35" stroke-width="1.5"/><line x1="505" y1="30" x2="505" y2="156" stroke="#211c35" stroke-width="2.5"/></svg>`;

const midiSvg = () => `<svg viewBox="0 0 520 170" role="img" aria-label="Exemple illustratif de notes MIDI dans un piano roll">
  <rect x="0" y="0" width="520" height="170" rx="12" fill="#f6f3ff"/>
  <g>${Array.from({length:10},(_,i)=>`<rect x="0" y="${8+i*15.5}" width="34" height="15" fill="${[1,3,6,8].includes(i)?'#211c35':'#fff'}" stroke="#ddd6ee"/>`).join('')}</g>
  <g stroke="#e6e0f5">${Array.from({length:9},(_,i)=>`<line x1="${34+i*56}" y1="6" x2="${34+i*56}" y2="164"/>`).join('')}</g>
  <g fill="#7549eb">${[[40,120,50],[96,104,40],[140,88,60],[204,72,46],[254,88,34],[292,104,52],[350,58,70],[424,72,40],[468,88,40]].map(([x,y,w])=>`<rect x="${x}" y="${y}" width="${w}" height="12" rx="3"/>`).join('')}</g></svg>`;

const xmlCode = () => `<pre style="margin:14px 0 10px;background:#17112e;color:#e6dcff;border-radius:12px;padding:16px;font-size:12px;line-height:1.55;overflow:auto"><code>&lt;note&gt;
  &lt;pitch&gt;&lt;step&gt;E&lt;/step&gt;&lt;octave&gt;4&lt;/octave&gt;&lt;/pitch&gt;
  &lt;duration&gt;1&lt;/duration&gt;
  &lt;type&gt;quarter&lt;/type&gt;
  &lt;notations&gt;&lt;technical&gt;
    &lt;string&gt;1&lt;/string&gt;&lt;fret&gt;0&lt;/fret&gt;
  &lt;/technical&gt;&lt;/notations&gt;
&lt;/note&gt;</code></pre>`;

// ---------- Contenu des pages ----------
// Les faits cités doivent rester alignés sur le produit (landing, FAQ, tarifs).
const PAGES = [
  {
    slug: 'youtube-en-partition',
    nav: 'YouTube en partition',
    teaser: 'Colle un lien YouTube, obtiens les notes',
    title: 'YouTube en partition : transformer une vidéo en partition | Tablurio',
    description: 'Colle un lien YouTube (vidéo ou Short) et obtiens la partition ou la tablature du morceau pour guitare, piano ou voix. Export PDF, MIDI, MusicXML. Essai gratuit.',
    kicker: '▶ YouTube → partition',
    h1: 'Transformer une vidéo YouTube en <em>partition</em>',
    lead: 'Tu as trouvé le morceau sur YouTube mais pas la partition ? Colle le lien de la vidéo : Tablurio écoute l’audio et te rend une partition ou une tablature prête à jouer.',
    placeholder: 'Colle un lien YouTube (vidéo ou Short)…',
    visual: { label: 'Exemple illustratif', title: 'Partition piano', sub: 'Depuis un lien YouTube', svg: staffSvg },
    stepsTitle: 'De YouTube à la partition, en 3 étapes',
    steps: [
      ['Colle le lien', 'Copie l’adresse de la vidéo depuis YouTube (ordinateur ou application) et colle-la ci-dessus. Les vidéos classiques et les Shorts sont acceptés.'],
      ['Choisis ton instrument', 'Guitare (partition ou tablature), piano ou voix. Tu peux aussi choisir l’extrait du morceau à transcrire.'],
      ['Joue ou exporte', 'La partition s’affiche à l’écran avec la lecture audio. Avec une offre payante, tu l’exportes en PDF, MIDI ou MusicXML.'],
    ],
    proseTitle: 'Pourquoi passer par YouTube ?',
    prose: `<p>YouTube est la plus grande bibliothèque musicale gratuite : versions studio, lives, reprises, covers acoustiques, morceaux introuvables ailleurs. Le problème, c’est que la partition, elle, n’existe pas toujours… ou se paie à l’unité.</p>
<p>Avec Tablurio, <strong>la vidéo devient la source de ta partition</strong>. L’intelligence artificielle analyse l’audio, repère les hauteurs de notes et leur rythme, puis les écrit sur une portée ou sur une tablature selon l’instrument choisi.</p>
<h3>Quelles vidéos donnent les meilleurs résultats ?</h3>
<ul><li><strong>Un son clair</strong> : une version studio ou une bonne captation live marche mieux qu’un enregistrement au téléphone.</li>
<li><strong>Un instrument qui ressort</strong> : un piano solo, une guitare acoustique ou une voix bien en avant facilitent le relevé.</li>
<li><strong>Des morceaux de 10 minutes maximum</strong> : au-delà, le lien est refusé. Tu peux choisir l’extrait qui t’intéresse.</li></ul>
<p>Sur un arrangement très dense (orchestre, mur de guitares saturées), quelques passages peuvent demander une retouche. C’est justement pour ça que l’export MIDI et MusicXML existe : tu corriges en quelques clics dans ton logiciel.</p>
<p class="sp-note">Utilise Tablurio pour des morceaux que tu as le droit de transcrire, par exemple pour ton apprentissage personnel. Tu le confirmes à chaque génération.</p>`,
    faq: [
      ['Est-ce que Tablurio accepte les YouTube Shorts ?', 'Oui. Les liens de vidéos classiques (youtube.com/watch), les liens courts (youtu.be) et les Shorts sont acceptés.'],
      ['Combien de temps faut-il pour obtenir la partition ?', 'En général une trentaine de secondes à une minute, selon la durée de l’extrait et l’affluence.'],
      ['Est-ce gratuit ?', 'Ton compte gratuit inclut 3 aperçus de 30 secondes pour juger le résultat sur tes propres morceaux. Le morceau complet et les exports sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Quelle est la durée maximale d’une vidéo ?', '10 minutes d’audio par génération. Pour un morceau plus long, choisis l’extrait que tu veux travailler.'],
      ['La partition est-elle exacte à 100 % ?', 'Non, c’est une transcription automatique. Elle est fidèle sur la grande majorité des notes, mais un passage très chargé peut demander une retouche. Vérifie toujours le résultat avant de jouer.'],
      ['Je peux aussi utiliser un lien Spotify ou Deezer ?', 'Oui : Tablurio retrouve le même morceau sur YouTube et te propose la version à utiliser. Tu peux aussi importer ton propre fichier audio.'],
    ],
  },
  {
    slug: 'tablature-guitare',
    nav: 'Générateur de tablature guitare',
    teaser: 'La tab guitare de n’importe quel morceau',
    instrument: 'guitare',
    title: 'Générateur de tablature guitare à partir d’une chanson | Tablurio',
    description: 'Génère la tablature guitare d’un morceau à partir d’un lien YouTube, Spotify, Deezer ou d’un fichier audio. Tab ou partition classique, export PDF, MIDI, MusicXML.',
    kicker: '🎸 Tablature guitare',
    h1: 'Générateur de <em>tablature guitare</em> à partir d’une chanson',
    lead: 'Plus besoin de chercher une tab qui n’existe pas ou de relever à l’oreille pendant des heures. Colle le lien du morceau, choisis la guitare, et récupère ta tablature.',
    placeholder: 'Colle le lien du morceau (YouTube, Spotify, Deezer)…',
    visual: { label: 'Exemple illustratif', title: 'Tablature guitare', sub: 'Accordage standard', svg: tabSvg },
    stepsTitle: 'Ta tab guitare en 3 étapes',
    steps: [
      ['Ajoute ton morceau', 'Colle un lien YouTube, Spotify ou Deezer, ou importe un fichier audio (MP3, WAV, M4A, FLAC).'],
      ['Choisis « Guitare » puis « Tablature »', 'Tu peux aussi demander une partition classique si tu lis le solfège.'],
      ['Joue avec la lecture audio', 'Suis la tab à l’écran en écoutant le morceau, puis exporte-la en PDF, MIDI ou MusicXML avec une offre payante.'],
    ],
    proseTitle: 'Tablature ou partition : laquelle choisir ?',
    prose: `<p>La <strong>tablature</strong> est la notation préférée des guitaristes : chacune des six lignes représente une corde, et chaque chiffre indique la case à jouer. Pas besoin de savoir lire le solfège pour s’en servir, c’est pour ça qu’elle est si populaire chez les autodidactes.</p>
<p>La <strong>partition classique</strong>, elle, donne la hauteur exacte des notes et leur rythme sur une portée. Elle est plus précise pour le rythme et se partage avec d’autres instrumentistes.</p>
<p>Sur Tablurio, tu n’as pas à choisir une fois pour toutes : pour la guitare, tu demandes la tablature ou la partition selon ce que tu préfères lire.</p>
<h3>Comment lire la tablature générée</h3>
<ul><li>La ligne du <strong>haut</strong> correspond à la corde de mi aigu, celle du <strong>bas</strong> au mi grave.</li>
<li>Un <strong>0</strong> signifie corde à vide, un <strong>3</strong> signifie 3e case.</li>
<li>Les chiffres alignés verticalement se jouent en même temps (un accord).</li></ul>
<h3>Pour quels morceaux ?</h3>
<p>Riffs, arpèges, mélodies, intros acoustiques : la transcription est la plus fiable quand la guitare ou la mélodie ressort bien du mix. Sur un morceau très chargé, certains passages peuvent demander une retouche, que tu peux faire dans un logiciel comme Guitar Pro ou MuseScore grâce à l’export MusicXML.</p>
<p>Tu joues de la basse ? La tablature 4 cordes est en bêta et arrive bientôt.</p>`,
    faq: [
      ['Le générateur de tablature est-il gratuit ?', 'Tu as 3 aperçus gratuits de 30 secondes pour tester sur tes propres morceaux. Le morceau complet et les exports sont inclus dans les offres Starter (10 €/mois), Pro (19 €/mois) et Lifetime (99 € une fois).'],
      ['Puis-je obtenir une partition au lieu d’une tablature ?', 'Oui. Pour la guitare, tu choisis entre tablature et partition classique.'],
      ['Quel accordage est utilisé ?', 'La tablature est écrite pour une guitare 6 cordes en accordage standard (mi la ré sol si mi).'],
      ['Puis-je ouvrir la tab dans Guitar Pro ou MuseScore ?', 'Oui, exporte-la en MusicXML : c’est le format d’échange accepté par la plupart des logiciels de notation, dont MuseScore et Guitar Pro.'],
      ['Ça marche avec un fichier audio que j’ai enregistré ?', 'Oui. Importe ton fichier MP3, WAV, M4A ou FLAC (25 Mo maximum) au lieu de coller un lien.'],
      ['Et pour la basse ?', 'La tablature basse 4 cordes est en bêta : elle sera disponible à la sortie de bêta.'],
    ],
  },
  {
    slug: 'partition-piano',
    nav: 'Partition piano d’une chanson',
    teaser: 'La partition piano de tes morceaux',
    instrument: 'piano',
    title: 'Partition piano à partir d’une chanson (lien ou audio) | Tablurio',
    description: 'Obtiens la partition piano d’une chanson à partir d’un lien YouTube, Spotify, Deezer ou d’un fichier audio. Lecture audio synchronisée, export PDF, MIDI, MusicXML.',
    kicker: '🎹 Partition piano',
    h1: 'La <em>partition piano</em> de n’importe quelle chanson',
    lead: 'Le morceau que tu veux jouer n’a pas de partition piano, ou elle coûte cher pour un titre que tu joueras deux semaines ? Colle le lien, Tablurio écrit les notes.',
    placeholder: 'Colle le lien de la chanson (YouTube, Spotify, Deezer)…',
    visual: { label: 'Exemple illustratif', title: 'Partition piano', sub: 'Exemple de mise en page', svg: staffSvg },
    stepsTitle: 'Ta partition piano en 3 étapes',
    steps: [
      ['Ajoute la chanson', 'Un lien YouTube, Spotify, Deezer, ou ton propre fichier audio.'],
      ['Choisis « Piano »', 'Sélectionne éventuellement l’extrait à transcrire (10 minutes maximum).'],
      ['Joue, imprime ou retouche', 'Lis la partition avec la lecture audio, puis exporte-la en PDF pour l’imprimer ou en MIDI / MusicXML pour la modifier.'],
    ],
    proseTitle: 'Une partition piano sans l’acheter à l’unité',
    prose: `<p>Sur les sites de partitions, chaque titre se paie séparément, et les morceaux récents ou peu connus sont souvent introuvables. Tablurio prend le problème à l’envers : <strong>tu pars de l’audio</strong>, et c’est l’IA qui écrit la partition.</p>
<h3>Ce que tu obtiens</h3>
<ul><li><strong>Une partition sur portée</strong>, lisible à l’écran, avec la lecture audio pour vérifier à l’oreille.</li>
<li><strong>Un PDF</strong> à imprimer et poser sur le pupitre.</li>
<li><strong>Un fichier MIDI</strong> pour le rejouer dans un clavier numérique, un logiciel comme Synthesia, ou ta station audio.</li>
<li><strong>Un fichier MusicXML</strong> pour l’ouvrir et le retravailler dans MuseScore, Dorico ou Sibelius.</li></ul>
<h3>Conseils pour un meilleur résultat</h3>
<p>Les versions piano solo, les reprises piano ou les morceaux où le piano est bien en avant donnent les relevés les plus propres. Sur une chanson avec beaucoup d’instruments, la transcription se concentre sur ce qui ressort le plus ; un passage très dense peut demander une retouche, simple à faire grâce au MusicXML.</p>
<p>Débutant ? Commence par un extrait court, joue-le lentement avec la lecture audio, puis enchaîne.</p>`,
    faq: [
      ['Peut-on obtenir la partition piano d’une chanson pop ?', 'Oui, à partir de n’importe quel morceau disponible sur YouTube, Spotify ou Deezer, ou d’un fichier audio. Le résultat est plus propre quand le piano ou la mélodie ressort bien.'],
      ['La partition est-elle gratuite ?', 'Tu as 3 aperçus gratuits de 30 secondes. Le morceau complet, le PDF, le MIDI et le MusicXML sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Puis-je imprimer la partition ?', 'Oui, exporte-la en PDF.'],
      ['Puis-je modifier les notes ?', 'Oui : exporte en MusicXML pour l’ouvrir dans MuseScore, Dorico ou Sibelius, ou en MIDI pour ta station audio.'],
      ['Combien de temps ça prend ?', 'En général une trentaine de secondes à une minute selon la durée de l’extrait.'],
      ['La transcription est-elle parfaite ?', 'C’est une transcription automatique : fidèle sur la grande majorité des notes, mais vérifie toujours le résultat, surtout sur les passages très chargés.'],
    ],
  },
  {
    slug: 'mp3-en-partition',
    nav: 'Convertir un MP3 en partition',
    teaser: 'Importe un fichier audio, récupère les notes',
    upload: true,
    title: 'Convertir un MP3 en partition (et WAV, M4A, FLAC) | Tablurio',
    description: 'Convertis un fichier MP3, WAV, M4A ou FLAC en partition ou tablature pour guitare, piano ou voix. Jusqu’à 25 Mo et 10 minutes. Export PDF, MIDI, MusicXML.',
    kicker: '⇧ Audio → partition',
    h1: 'Convertir un <em>MP3 en partition</em>',
    lead: 'Un enregistrement de répétition, une démo, un morceau acheté en MP3 ? Importe le fichier audio : Tablurio le transforme en partition ou en tablature.',
    placeholder: 'Ou colle un lien YouTube, Spotify, Deezer…',
    visual: { label: 'Exemple illustratif', title: 'Partition', sub: 'Depuis un fichier MP3', svg: staffSvg },
    stepsTitle: 'Du fichier audio à la partition',
    steps: [
      ['Importe ton fichier', 'MP3, WAV, M4A ou FLAC, jusqu’à 25 Mo et 10 minutes d’audio.'],
      ['Choisis ton instrument', 'Guitare (partition ou tablature), piano ou voix.'],
      ['Récupère tes notes', 'Partition à l’écran avec la lecture audio, puis export PDF, MIDI ou MusicXML avec une offre payante.'],
    ],
    proseTitle: 'Pourquoi convertir un fichier audio plutôt qu’un lien ?',
    prose: `<p>Tous les morceaux ne sont pas sur YouTube. Tes propres compositions, l’enregistrement d’un cours, une maquette de ton groupe ou un fichier acheté sur une boutique en ligne : <strong>l’import de fichier</strong> te permet de transcrire exactement l’audio que tu as sous la main.</p>
<h3>Formats acceptés</h3>
<ul><li><strong>MP3</strong> : le plus courant, parfait pour la plupart des usages.</li>
<li><strong>WAV</strong> et <strong>FLAC</strong> : sans perte, idéals pour une maquette ou un enregistrement de qualité.</li>
<li><strong>M4A</strong> : le format des mémos vocaux de l’iPhone et de nombreux téléchargements.</li></ul>
<p>Taille maximale : 25 Mo par fichier, et 10 minutes d’audio par génération.</p>
<h3>Bien préparer ton enregistrement</h3>
<p>Plus l’instrument est net, meilleur est le relevé : évite le bruit de fond, enregistre près de la source, et coupe les longs silences. Un mémo vocal où tu fredonnes une mélodie peut aussi devenir une partition pour la voix.</p>
<p class="sp-note">N’importe que des enregistrements dont tu disposes des droits de transcription (tes compositions, ton apprentissage personnel…).</p>`,
    faq: [
      ['Quels formats audio sont acceptés ?', 'MP3, WAV, M4A et FLAC, jusqu’à 25 Mo.'],
      ['Y a-t-il une durée maximale ?', 'Oui, 10 minutes d’audio par génération.'],
      ['Puis-je convertir un mémo vocal de mon téléphone ?', 'Oui. Les mémos vocaux de l’iPhone sont en M4A, un format accepté. Choisis « Voix » pour obtenir la ligne de chant en partition.'],
      ['La conversion est-elle gratuite ?', 'Tu as 3 aperçus gratuits de 30 secondes. Le morceau complet et les exports sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Mon fichier est-il conservé ?', 'Il sert à générer ta partition, que tu retrouves ensuite dans ta bibliothèque Tablurio.'],
      ['Je peux convertir un MP3 en MIDI ?', 'Oui : une fois la partition générée, exporte-la en MIDI avec une offre payante.'],
    ],
  },
  {
    slug: 'spotify-en-partition',
    nav: 'Spotify en partition',
    teaser: 'Un titre Spotify devient une partition',
    title: 'Spotify en partition : la partition d’un titre Spotify | Tablurio',
    description: 'Colle un lien de titre Spotify et obtiens sa partition ou sa tablature pour guitare, piano ou voix. Tablurio retrouve le morceau et transcrit les notes.',
    kicker: '◉ Spotify → partition',
    h1: 'De <em>Spotify</em> à la partition',
    lead: 'Tu écoutes le morceau en boucle sur Spotify et tu veux enfin le jouer ? Colle le lien du titre : Tablurio retrouve le morceau et en écrit la partition ou la tablature.',
    placeholder: 'Colle un lien de titre Spotify…',
    visual: { label: 'Exemple illustratif', title: 'Tablature guitare', sub: 'Depuis un titre Spotify', svg: tabSvg },
    stepsTitle: 'Comment ça marche avec Spotify',
    steps: [
      ['Copie le lien du titre', 'Dans Spotify, ouvre le menu « … » du morceau, puis Partager › Copier le lien du titre.'],
      ['Vérifie la version proposée', 'L’audio de Spotify est protégé : Tablurio retrouve le même morceau sur YouTube et te propose la version à utiliser, avec des alternatives.'],
      ['Choisis ton instrument', 'Guitare, piano ou voix, puis lis ta partition avec la lecture audio et exporte-la.'],
    ],
    proseTitle: 'Pourquoi Tablurio passe par YouTube',
    prose: `<p>Spotify ne permet pas de récupérer l’audio de ses titres. Plutôt que de te bloquer, Tablurio utilise le lien Spotify pour <strong>identifier le morceau</strong> (titre, artiste), puis cherche la même chanson sur YouTube. Tu vois la version trouvée avant de lancer la transcription, et tu peux en choisir une autre si ce n’est pas la bonne (live, remix, reprise…).</p>
<p>Si le morceau n’est pas trouvé, tu peux coller directement un lien YouTube ou importer ton propre fichier audio.</p>
<h3>Quels liens Spotify fonctionnent ?</h3>
<ul><li><strong>Les liens de titres</strong> (open.spotify.com/track/…) : oui.</li>
<li>Les playlists, albums et podcasts : non, choisis un titre précis.</li></ul>
<h3>Idéal pour…</h3>
<p>Transformer tes « titres likés » en répertoire : choisis le morceau du moment, génère la partition ou la tab, et travaille-le avec la lecture audio.</p>`,
    faq: [
      ['Tablurio télécharge-t-il l’audio depuis Spotify ?', 'Non. Le lien Spotify sert à identifier le morceau ; Tablurio retrouve ensuite la même chanson sur YouTube et te propose la version à utiliser.'],
      ['Que faire si la version proposée n’est pas la bonne ?', 'Choisis une des alternatives proposées, ou colle directement le lien YouTube de la version que tu veux.'],
      ['Puis-je coller un lien de playlist ?', 'Non, colle le lien d’un titre précis.'],
      ['Est-ce gratuit ?', 'Tu as 3 aperçus gratuits de 30 secondes. Le morceau complet et les exports sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Quels instruments sont disponibles ?', 'Guitare (partition ou tablature), piano et voix. La basse est en bêta ; le violon et la batterie arrivent bientôt.'],
    ],
  },
  {
    slug: 'deezer-en-partition',
    nav: 'Deezer en partition',
    teaser: 'Un titre Deezer devient une partition',
    title: 'Deezer en partition : la partition d’un titre Deezer | Tablurio',
    description: 'Colle un lien de titre Deezer et obtiens sa partition ou sa tablature pour guitare, piano ou voix. Tablurio retrouve le morceau et transcrit les notes.',
    kicker: '▥ Deezer → partition',
    h1: 'De <em>Deezer</em> à la partition',
    lead: 'Un titre de ta bibliothèque Deezer que tu aimerais jouer ? Colle son lien : Tablurio retrouve le morceau et le transforme en partition ou en tablature.',
    placeholder: 'Colle un lien de titre Deezer…',
    visual: { label: 'Exemple illustratif', title: 'Partition piano', sub: 'Depuis un titre Deezer', svg: staffSvg },
    stepsTitle: 'Comment ça marche avec Deezer',
    steps: [
      ['Copie le lien du titre', 'Dans Deezer, ouvre le menu du morceau, puis Partager › Copier le lien.'],
      ['Vérifie la version', 'Tablurio retrouve le même morceau sur YouTube et te propose la version à utiliser. Si aucune n’est trouvée, l’extrait officiel de 30 secondes de Deezer peut servir de repli.'],
      ['Choisis ton instrument', 'Guitare, piano ou voix, puis lis ta partition et exporte-la.'],
    ],
    proseTitle: 'Deezer, YouTube et l’extrait de 30 secondes',
    prose: `<p>L’audio complet des titres Deezer est protégé. Tablurio utilise donc ton lien pour <strong>identifier le morceau</strong>, puis cherche la même chanson sur YouTube. Tu valides la version trouvée (ou une alternative) avant de lancer la transcription.</p>
<p>Si le morceau n’existe pas sur YouTube, Tablurio peut utiliser <strong>l’extrait officiel de 30 secondes</strong> fourni par Deezer, quand il est disponible. Pour le morceau entier, colle un lien YouTube ou importe ton fichier audio.</p>
<h3>Quels liens Deezer fonctionnent ?</h3>
<ul><li><strong>Les liens de titres</strong> (deezer.com/track/… ou liens de partage) : oui.</li>
<li>Les playlists, albums et Flow : non, choisis un titre précis.</li></ul>`,
    faq: [
      ['Tablurio télécharge-t-il l’audio depuis Deezer ?', 'Non. Le lien sert à identifier le morceau ; Tablurio retrouve la même chanson sur YouTube. À défaut, l’extrait officiel de 30 secondes de Deezer peut être utilisé.'],
      ['Puis-je transcrire un morceau entier depuis Deezer ?', 'Oui, dès que la version YouTube est trouvée. Sinon, colle un lien YouTube ou importe ton fichier audio.'],
      ['Puis-je coller un lien d’album ou de playlist ?', 'Non, colle le lien d’un titre précis.'],
      ['Est-ce gratuit ?', 'Tu as 3 aperçus gratuits de 30 secondes. Le morceau complet et les exports sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Quels formats d’export ?', 'PDF pour lire ou imprimer, MIDI et MusicXML pour retravailler la partition dans un logiciel.'],
    ],
  },
  {
    slug: 'musicxml',
    nav: 'Export MusicXML',
    teaser: 'Ouvre tes partitions dans MuseScore, Dorico…',
    title: 'Export MusicXML : ouvrir ta partition dans MuseScore ou Guitar Pro | Tablurio',
    description: 'Qu’est-ce que le MusicXML et à quoi ça sert ? Génère la partition d’un morceau puis exporte-la en MusicXML pour la modifier dans MuseScore, Dorico, Sibelius ou Guitar Pro.',
    kicker: '♬ Format MusicXML',
    h1: 'Ta partition en <em>MusicXML</em>, prête à modifier',
    lead: 'Génère la partition ou la tablature d’un morceau, puis exporte-la en MusicXML pour la retoucher, l’arranger ou la transposer dans ton logiciel de notation préféré.',
    placeholder: 'Colle le lien d’un morceau (YouTube, Spotify, Deezer)…',
    visual: { label: 'Extrait de fichier', title: 'MusicXML', sub: 'Une note de tablature décrite en XML', code: xmlCode },
    stepsTitle: 'Obtenir un fichier MusicXML',
    steps: [
      ['Génère ta partition', 'À partir d’un lien YouTube, Spotify, Deezer ou d’un fichier audio, pour guitare, piano ou voix.'],
      ['Exporte en MusicXML', 'Depuis l’écran de la partition, télécharge le fichier (offres Starter, Pro et Lifetime).'],
      ['Ouvre-le dans ton logiciel', 'MuseScore, Dorico, Sibelius, Guitar Pro et la plupart des éditeurs de partitions l’importent.'],
    ],
    proseTitle: 'MusicXML, c’est quoi ?',
    prose: `<p>Le <strong>MusicXML</strong> est un format ouvert, créé pour échanger des partitions entre logiciels. Contrairement à un PDF (une image figée) ou au MIDI (des notes jouées, sans mise en page), il décrit la partition elle-même : notes, rythmes, mesures, clés, altérations, et même cordes et cases pour une tablature.</p>
<h3>Pourquoi l’exporter ?</h3>
<ul><li><strong>Corriger</strong> une note ou un rythme après la transcription automatique.</li>
<li><strong>Transposer</strong> le morceau dans une tonalité plus confortable pour ta voix ou ton instrument.</li>
<li><strong>Arranger</strong> : ajouter des doigtés, des nuances, une seconde voix.</li>
<li><strong>Partager</strong> la partition avec un professeur ou ton groupe, qui l’ouvrira dans son propre logiciel.</li></ul>
<h3>MusicXML, MIDI ou PDF ?</h3>
<p>Le <strong>PDF</strong> sert à lire et imprimer. Le <a href="/midi"><strong>MIDI</strong></a> sert à rejouer et produire du son. Le <strong>MusicXML</strong> sert à éditer la partition. Avec une offre Tablurio, tu récupères les trois.</p>`,
    faq: [
      ['Quels logiciels ouvrent le MusicXML ?', 'La plupart des éditeurs de partitions : MuseScore (gratuit), Dorico, Sibelius, Guitar Pro, et de nombreuses applications mobiles.'],
      ['Quelle différence entre MusicXML et MIDI ?', 'Le MIDI décrit des notes jouées (hauteur, durée, intensité), idéal pour le son. Le MusicXML décrit la partition écrite (mesures, clés, tablature), idéal pour la notation.'],
      ['L’export MusicXML est-il inclus dans l’offre gratuite ?', 'L’aperçu gratuit se lit à l’écran. Les exports PDF, MIDI et MusicXML sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Puis-je exporter une tablature guitare en MusicXML ?', 'Oui, et l’ouvrir ensuite dans Guitar Pro ou MuseScore pour la modifier.'],
      ['Le fichier a-t-il l’extension .musicxml ou .xml ?', 'Les deux désignent le même format ; les logiciels de notation reconnaissent le fichier exporté par Tablurio.'],
    ],
  },
  {
    slug: 'midi',
    nav: 'Export MIDI',
    teaser: 'Les notes d’un morceau en fichier MIDI',
    title: 'Convertir un morceau en MIDI (YouTube, MP3…) | Tablurio',
    description: 'Transforme un morceau en fichier MIDI à partir d’un lien YouTube, Spotify, Deezer ou d’un fichier audio. Pour Synthesia, ton clavier, GarageBand, Logic, Ableton ou FL Studio.',
    kicker: '♪ Format MIDI',
    h1: 'Convertir un morceau en <em>fichier MIDI</em>',
    lead: 'Récupère les notes d’un morceau en MIDI pour les rejouer sur ton clavier, les apprendre dans une appli, ou les retravailler dans ta station audio.',
    placeholder: 'Colle le lien d’un morceau (YouTube, Spotify, Deezer)…',
    visual: { label: 'Exemple illustratif', title: 'Fichier MIDI', sub: 'Les notes dans un piano roll', svg: midiSvg },
    stepsTitle: 'Obtenir le MIDI d’un morceau',
    steps: [
      ['Ajoute le morceau', 'Lien YouTube, Spotify, Deezer ou fichier audio (MP3, WAV, M4A, FLAC).'],
      ['Choisis ton instrument', 'Piano, guitare ou voix : la transcription s’adapte à l’instrument.'],
      ['Exporte en MIDI', 'Télécharge le fichier .mid depuis l’écran de la partition (offres Starter, Pro et Lifetime).'],
    ],
    proseTitle: 'À quoi sert un fichier MIDI ?',
    prose: `<p>Un fichier <strong>MIDI</strong> ne contient pas de son : il contient des <strong>instructions</strong> (quelle note, quand, combien de temps, à quelle intensité). N’importe quel instrument virtuel ou clavier peut ensuite les jouer, avec le son que tu veux.</p>
<h3>Ce que tu peux en faire</h3>
<ul><li><strong>Apprendre au piano</strong> avec une application qui affiche les notes qui tombent, comme Synthesia.</li>
<li><strong>Produire</strong> : glisse le MIDI dans GarageBand, Logic Pro, Ableton Live ou FL Studio et change le son, le tempo, la tonalité.</li>
<li><strong>Jouer sur ton clavier numérique</strong> ou ton synthé.</li>
<li><strong>Retoucher les notes</strong> dans un piano roll avant de réimporter le tout dans un logiciel de partition.</li></ul>
<h3>MIDI ou MusicXML ?</h3>
<p>Le MIDI est fait pour le son et la production. Si ton but est d’éditer la partition écrite (mesures, tablature, mise en page), préfère le <a href="/musicxml"><strong>MusicXML</strong></a>. Bonne nouvelle : les offres Tablurio incluent les deux, plus le PDF.</p>`,
    faq: [
      ['Comment convertir une vidéo YouTube en MIDI ?', 'Colle le lien de la vidéo, choisis ton instrument, laisse Tablurio générer la partition, puis exporte-la en MIDI.'],
      ['Comment convertir un MP3 en MIDI ?', 'Importe ton fichier MP3 (25 Mo et 10 minutes maximum), génère la partition, puis exporte-la en MIDI.'],
      ['Le fichier MIDI fonctionne-t-il dans Synthesia ?', 'Oui, Synthesia et la plupart des applications d’apprentissage du piano ouvrent les fichiers MIDI.'],
      ['L’export MIDI est-il gratuit ?', 'L’aperçu gratuit se lit à l’écran. Les exports PDF, MIDI et MusicXML sont inclus dans les offres Starter, Pro et Lifetime.'],
      ['Le MIDI contient-il tous les instruments du morceau ?', 'Non : il contient la transcription de l’instrument que tu as choisi (piano, guitare ou voix).'],
    ],
  },
];

// ---------- Gabarit ----------
const LOGO = '/assets/tablurio-wave-mark.svg';
const header = () => `<header class="sp-header"><div class="wrap sp-nav">
  <a href="/" class="sp-brand" aria-label="Tablurio, accueil"><img src="${LOGO}" alt="Logo Tablurio" width="37" height="37"><span>tablurio<span>.com</span></span></a>
  <nav class="sp-links" aria-label="Menu principal"><a href="/#comment-ca-marche">Comment ça marche ?</a><a href="/fonctionnalites">Fonctionnalités</a><a href="/tarifs">Tarifs</a><a href="/faq">FAQ</a></nav>
  <div class="sp-actions"><a class="sp-login" href="/connexion">Se connecter</a><a class="sp-cta" href="#outil">Commencer ↗</a></div>
</div></header>`;

const footer = (current) => `<footer class="sp-footer"><div class="wrap sp-footer-grid">
  <div><a href="/" class="sp-brand"><img src="${LOGO}" alt="Logo Tablurio" width="37" height="37"><span>tablurio<span>.com</span></span></a><small>Ta musique mérite d’être jouée.</small></div>
  <div><h4>Outils</h4><nav aria-label="Outils">${PAGES.slice(0, 4).map(p => `<a href="/${p.slug}"${p.slug === current ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`).join('')}</nav></div>
  <div><h4>Sources et formats</h4><nav aria-label="Sources et formats">${PAGES.slice(4).map(p => `<a href="/${p.slug}"${p.slug === current ? ' aria-current="page"' : ''}>${esc(p.nav)}</a>`).join('')}</nav></div>
  <div><h4>Tablurio</h4><nav aria-label="Tablurio"><a href="/">Accueil</a><a href="/fonctionnalites">Fonctionnalités</a><a href="/tarifs">Tarifs</a><a href="/faq">FAQ</a><a href="/legal">Mentions</a></nav><small>Partitions et tablatures générées par IA : vérifie toujours le résultat avant de jouer.</small><small>© 2026 Tablurio</small></div>
</div></footer>`;

const visual = v => `<div class="sp-visual" aria-label="${esc(v.label)}">
  <div class="sp-visual-top"><span>${esc(v.label)}</span><b>● Prête</b></div>
  <h3>${esc(v.title)}</h3><small>${esc(v.sub)}</small>
  ${v.code ? v.code() : v.svg()}
  <div class="sp-chips"><span>↓ PDF</span><span>MIDI</span><span>MusicXML</span></div>
</div>`;

const tool = p => `<div class="sp-tool" id="outil">
  <form class="sp-tool-form" action="/" method="get" data-instrument="${p.instrument || ''}" novalidate>
    <span aria-hidden="true">↗</span>
    <label class="visually-hidden" for="sp-link" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Lien du morceau</label>
    <input id="sp-link" name="lien" type="url" inputmode="url" autocomplete="off" placeholder="${esc(p.placeholder)}">
    <button type="submit">${p.upload ? 'Continuer' : 'Créer ma partition'} →</button>
  </form>
  <p class="sp-tool-error" role="alert"></p>
  <div class="sp-tool-alt">${p.upload
    ? '<a href="/?source=fichier">⇧ Importer un fichier audio (MP3, WAV, M4A, FLAC)</a>'
    : '<span>Pas de lien ?</span><a href="/?source=fichier">Importer un fichier audio</a>'}</div>
  <div class="sp-badges"><span><b>✓</b>3 aperçus gratuits de 30 s</span><span><b>✓</b>Guitare, piano, voix</span><span><b>✓</b>PDF · MIDI · MusicXML</span></div>
</div>`;

const toolScript = `<script>
document.querySelectorAll('.sp-tool-form').forEach(function(form){
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var input=form.querySelector('input'),err=form.parentNode.querySelector('.sp-tool-error'),v=input.value.trim();
    if(!v){err.textContent='Colle le lien du morceau, ou importe un fichier audio.';input.focus();return;}
    if(!/^https:\\/\\//i.test(v)){err.textContent='Colle un lien complet qui commence par https://';input.focus();return;}
    var q=new URLSearchParams({lien:v});if(form.dataset.instrument)q.set('instrument',form.dataset.instrument);
    location.href='/?'+q.toString();
  });
});
</script>`;

function jsonLd(p) {
  const url = `${SITE}/${p.slug}`;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebPage', '@id': `${url}#page`, url, name: strip(p.title), description: p.description, inLanguage: 'fr-FR',
        isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#app` }, dateModified: TODAY,
        breadcrumb: { '@id': `${url}#breadcrumb` } },
      { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`, itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: p.nav, item: url } ] },
      { '@type': 'FAQPage', '@id': `${url}#faq`, mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
    ],
  };
}

function page(p) {
  const url = `${SITE}/${p.slug}`;
  const related = PAGES.filter(o => o.slug !== p.slug);
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(p.title)}</title>
  <meta name="description" content="${esc(p.description)}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#0b0719">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-wave-32.png?v=1">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Tablurio">
  <meta property="og:locale" content="fr_FR">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${esc(p.title)}">
  <meta property="og:description" content="${esc(p.description)}">
  <meta property="og:image" content="${SITE}/assets/og-tablurio.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${SITE}/assets/og-tablurio.jpg">
  <link rel="stylesheet" href="/assets/seo-pages.css?v=1">
  <script type="application/ld+json">${JSON.stringify(jsonLd(p))}</script>
</head>
<body>
${header()}
<main>
  <section class="sp-hero">
    <div class="wrap">
      <nav class="sp-crumbs" aria-label="Fil d’Ariane"><a href="/">Accueil</a> › <span aria-current="page">${esc(p.nav)}</span></nav>
      <div class="sp-hero-grid">
        <div>
          <span class="sp-kicker">${esc(p.kicker)}</span>
          <h1>${p.h1}</h1>
          <p class="sp-lead">${esc(p.lead)}</p>
          ${tool(p)}
        </div>
        ${visual(p.visual)}
      </div>
    </div>
  </section>

  <section class="sp-section alt">
    <div class="wrap sp-center">
      <span class="sp-label">Comment ça marche ?</span>
      <h2>${esc(p.stepsTitle)}</h2>
      <div class="sp-steps" style="text-align:left">${p.steps.map(([t, d], i) => `<div class="sp-step"><i>${i + 1}</i><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div>
    </div>
  </section>

  <section class="sp-section">
    <div class="wrap narrow">
      <span class="sp-label">Le guide</span>
      <h2>${esc(p.proseTitle)}</h2>
      <div class="sp-prose">${p.prose}</div>
    </div>
  </section>

  <section class="sp-section dark">
    <div class="wrap sp-center">
      <span class="sp-label">Pourquoi Tablurio</span>
      <h2>Moins de temps à chercher. Plus de temps à jouer.</h2>
      <div class="sp-cards" style="text-align:left">
        <div class="sp-card"><span class="emoji">⚡</span><b>Rapide</b><p>Ta partition en une trentaine de secondes à une minute, au lieu d’heures à relever à l’oreille.</p></div>
        <div class="sp-card"><span class="emoji">♾️</span><b>Fini l’achat à l’unité</b><p>Un accès pour tous tes morceaux : change de titre aussi souvent que tu veux.</p></div>
        <div class="sp-card"><span class="emoji">🎸</span><b>Plusieurs instruments</b><p>Le même morceau pour guitare (tab ou partition), piano ou voix.</p></div>
        <div class="sp-card"><span class="emoji">📄</span><b>Formats utiles</b><p>PDF pour imprimer, MIDI et MusicXML pour retravailler dans ton logiciel.</p></div>
      </div>
    </div>
  </section>

  <section class="sp-section">
    <div class="wrap sp-faq-grid">
      <div><span class="sp-label">FAQ</span><h2>Les réponses avant de jouer.</h2><p class="sp-intro">Une autre question ? Consulte la <a href="/faq" style="color:var(--purple);font-weight:700">FAQ complète</a> ou les <a href="/tarifs" style="color:var(--purple);font-weight:700">tarifs</a>.</p></div>
      <div class="sp-faq">${p.faq.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
    </div>
  </section>

  <section class="sp-section alt">
    <div class="wrap">
      <span class="sp-label">Autres outils</span>
      <h2>Toutes les façons d’obtenir tes notes</h2>
      <div class="sp-related">${related.map(o => `<a href="/${o.slug}"><b>${esc(o.nav)}</b><span>${esc(o.teaser)}</span></a>`).join('')}</div>
    </div>
  </section>

  <section class="sp-section">
    <div class="wrap"><div class="sp-cta-band">
      <h2>La prochaine musique que tu vas jouer commence ici.</h2>
      <p>3 aperçus gratuits de 30 secondes pour tester sur tes propres morceaux.</p>
      <a href="#outil">Créer ma partition ↗</a>
    </div></div>
  </section>
</main>
${footer(p.slug)}
${toolScript}
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
for (const p of PAGES) writeFileSync(join(OUT, `${p.slug}.html`), page(p));

// Sitemap : pages publiques de la landing + pages outils.
const core = ['/', '/fonctionnalites', '/resultats', '/tarifs', '/faq'];
const urls = [...core, ...PAGES.map(p => `/${p.slug}`)];
writeFileSync(join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);

export { PAGES };
console.log(`${PAGES.length} pages générées dans outils/, sitemap.xml mis à jour (${urls.length} URLs).`);
