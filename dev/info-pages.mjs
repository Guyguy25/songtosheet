// Pages « À propos » et « Contact » (FR + EN), générées avec le même habillage que la landing.
// Les faits cités doivent rester exacts : identité légale, fonctionnement, engagements.
const SIRET = '100 871 250 00013';
const EMAIL = 'contact@tablurio.com';
const TRUSTPILOT = 'https://www.trustpilot.com/review/tablurio.com';

const card = (title, body) => `<div class="sp-step"><h3>${title}</h3><p>${body}</p></div>`;

export const INFO_PAGES = [
  {
    lang: 'fr', path: 'a-propos', alt: 'en/about', type: 'AboutPage', nav: 'À propos',
    title: 'À propos de Tablurio : qui est derrière le service | Tablurio',
    description: 'Tablurio est un service français créé par Tanguy Bois, entrepreneur indépendant dans le Nord. Pourquoi Tablurio existe, comment il fonctionne et nos engagements.',
    kicker: '♪ À propos', h1: 'Ta musique mérite <em>d’être jouée</em>.',
    lead: 'Tablurio transforme les morceaux que tu aimes en partitions et tablatures, pour que tu passes moins de temps à chercher et plus de temps à jouer.',
    sections: [
      ['Pourquoi Tablurio existe', `<p>Les partitions se vendent le plus souvent <strong>à l’unité</strong>, pour un morceau qu’on joue quelques semaines avant de passer au suivant. Les titres récents ou moins connus n’en ont souvent pas du tout, et relever un morceau à l’oreille prend des heures.</p>
<p>Tablurio part de l’inverse : <strong>tu pars de la musique</strong>. Tu colles un lien YouTube, Spotify ou Deezer, ou tu importes un fichier audio, tu choisis ton instrument, et tu obtiens la partition ou la tablature du morceau.</p>`],
      ['Qui est derrière', `<p>Tablurio est conçu, développé et exploité par <strong>Tanguy Bois</strong>, entrepreneur indépendant (micro-entreprise) basé à Wavrechain-sous-Denain, dans le Nord. C’est un <strong>service français</strong>, à taille humaine.</p>
<p>Les informations légales complètes (SIRET ${SIRET}, adresse, hébergement) sont dans les <a href="/legal">mentions légales</a>.</p>`],
      ['Comment ça marche', `<p>L’intelligence artificielle analyse l’audio, repère les hauteurs de notes et leur rythme, puis les écrit sur une portée ou une tablature. Plusieurs moteurs de transcription produisent chacun une version, et Tablurio te recommande la plus fidèle au morceau : tu peux toujours écouter et choisir.</p>
<p>L’audio sert uniquement à la génération : il est effacé au plus tard 2 heures après. La partition, elle, reste dans ta bibliothèque.</p>`],
    ],
    commitmentsTitle: 'Nos engagements',
    commitments: [
      ['Transparence', 'C’est une transcription automatique : fidèle sur la grande majorité des notes, mais à vérifier avant de jouer. Une génération qui échoue n’est jamais décomptée.'],
      ['Tes données', 'Rien n’est vendu. Tu peux télécharger toutes tes données et supprimer ton compte toi-même, depuis « Profil et paramètres ».'],
      ['Paiement sécurisé', 'Les paiements passent par Whop : Tablurio ne voit et ne garde aucune donnée bancaire. Tu résilies quand tu veux.'],
      ['Droits d’auteur', 'Tablurio sert à transcrire des morceaux que tu as le droit d’utiliser, pour ton usage personnel. Un ayant droit peut demander le retrait d’un contenu.'],
    ],
    ctaTitle: 'Une question, une idée ?', ctaText: 'Écris-nous, ou laisse ton avis sur Trustpilot.',
  },
  {
    lang: 'en', path: 'en/about', alt: 'a-propos', type: 'AboutPage', nav: 'About',
    title: 'About Tablurio: who is behind the service | Tablurio',
    description: 'Tablurio is a French service created by Tanguy Bois, an independent entrepreneur in northern France. Why Tablurio exists, how it works and our commitments.',
    kicker: '♪ About', h1: 'Your music deserves <em>to be played</em>.',
    lead: 'Tablurio turns the songs you love into sheet music and tabs, so you spend less time searching and more time playing.',
    sections: [
      ['Why Tablurio exists', `<p>Sheet music is usually sold <strong>song by song</strong>, for a track you play for a few weeks before moving on. Recent or lesser-known songs often have none at all, and learning a song by ear takes hours.</p>
<p>Tablurio flips it around: <strong>you start from the music</strong>. Paste a YouTube, Spotify or Deezer link, or upload an audio file, pick your instrument, and get the song’s sheet music or tab.</p>`],
      ['Who is behind it', `<p>Tablurio is designed, built and run by <strong>Tanguy Bois</strong>, an independent entrepreneur (French micro-enterprise) based in Wavrechain-sous-Denain, in northern France. It’s a <strong>small, French service</strong>.</p>
<p>Full legal information (SIRET ${SIRET}, address, hosting) is on the <a href="/legal">legal page</a>.</p>`],
      ['How it works', `<p>The AI analyses the audio, detects pitches and rhythm, then writes them on a staff or a tab. Several transcription engines each produce a version, and Tablurio recommends the one closest to the song: you can always listen and choose.</p>
<p>The audio is only used for the generation and is deleted within 2 hours. Your sheet music stays in your library.</p>`],
    ],
    commitmentsTitle: 'Our commitments',
    commitments: [
      ['Transparency', 'It’s an automatic transcription: accurate on the vast majority of notes, but always check it before playing. A failed generation never counts against your quota.'],
      ['Your data', 'Nothing is sold. You can download all your data and delete your account yourself, from “Profile and settings”.'],
      ['Secure payment', 'Payments go through Whop: Tablurio never sees or stores any card details. Cancel whenever you like.'],
      ['Copyright', 'Tablurio is for transcribing songs you’re allowed to use, for personal use. Rights holders can ask for content to be removed.'],
    ],
    ctaTitle: 'A question, an idea?', ctaText: 'Write to us, or leave a review on Trustpilot.',
  },
  {
    lang: 'fr', path: 'contact', alt: 'en/contact', type: 'ContactPage', nav: 'Contact',
    title: 'Contacter Tablurio | Tablurio',
    description: 'Une question sur Tablurio, ton abonnement ou une partition ? Écris à contact@tablurio.com. Informations légales et liens utiles.',
    kicker: '✉ Contact', h1: 'Une question ? <em>Écris-nous.</em>',
    lead: 'Aide, abonnement, signalement ou partenariat : tout passe par une seule adresse.',
    email: true,
    sections: [
      ['Pour quoi nous écrire', `<div class="sp-steps" style="margin-top:8px">
${card('Aide et partitions', 'Une génération qui ne se passe pas comme prévu, une question sur un résultat ou un format d’export.')}
${card('Abonnement', 'Tu résilies ou changes d’offre toi-même depuis « Mon abonnement ». Pour une rétractation ou un problème de paiement, écris-nous.')}
${card('Droits et signalements', 'Tu es ayant droit et un contenu te pose problème : indique-le, il est retiré rapidement après vérification.')}
</div>`],
      ['Pour qu’on t’aide plus vite', `<ul><li>L’<strong>adresse e-mail de ton compte</strong> Tablurio.</li>
<li>Le <strong>lien du morceau</strong> ou le nom du fichier concerné.</li>
<li>Une <strong>capture d’écran</strong> si quelque chose s’affiche mal.</li></ul>
<p>Beaucoup de réponses sont déjà dans la <a href="/faq">FAQ</a> et sur la page <a href="/tarifs">Tarifs</a>.</p>`],
      ['Informations légales', `<p>Tablurio est édité par <strong>Tanguy Bois</strong>, entrepreneur individuel (micro-entreprise), SIRET ${SIRET}. Adresse postale et autres informations dans les <a href="/legal">mentions légales</a>.</p>`],
    ],
    ctaTitle: 'Tu aimes Tablurio ?', ctaText: 'Ton avis aide d’autres musiciens à nous découvrir.',
  },
  {
    lang: 'en', path: 'en/contact', alt: 'contact', type: 'ContactPage', nav: 'Contact',
    title: 'Contact Tablurio | Tablurio',
    description: 'A question about Tablurio, your plan or a piece of sheet music? Email contact@tablurio.com. Legal information and useful links.',
    kicker: '✉ Contact', h1: 'A question? <em>Write to us.</em>',
    lead: 'Help, billing, reports or partnerships: everything goes through one address.',
    email: true,
    sections: [
      ['What to write to us about', `<div class="sp-steps" style="margin-top:8px">
${card('Help and sheet music', 'A generation that didn’t go as expected, a question about a result or an export format.')}
${card('Your plan', 'You cancel or change plan yourself from “My plan”. For a withdrawal or a payment issue, write to us.')}
${card('Rights and reports', 'If you’re a rights holder and some content is a problem, tell us: it’s removed quickly after checking.')}
</div>`],
      ['To help us help you faster', `<ul><li>The <strong>email address of your</strong> Tablurio account.</li>
<li>The <strong>song link</strong> or the name of the file.</li>
<li>A <strong>screenshot</strong> if something looks wrong.</li></ul>
<p>Many answers are already in the <a href="/faq">FAQ</a> and on the <a href="/tarifs">pricing</a> page.</p>`],
      ['Legal information', `<p>Tablurio is published by <strong>Tanguy Bois</strong>, sole trader (French micro-enterprise), SIRET ${SIRET}. Postal address and more on the <a href="/legal">legal page</a>.</p>`],
    ],
    ctaTitle: 'Enjoying Tablurio?', ctaText: 'Your review helps other musicians find us.',
  },
];

export const INFO_CONST = { EMAIL, TRUSTPILOT };
