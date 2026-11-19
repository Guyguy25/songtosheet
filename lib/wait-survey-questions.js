'use strict';
// Questions asked while a generation runs, always in this order, at most PER_GENERATION each time.
// Answered or skipped questions are never asked again. Keep existing ids stable: answers are stored by id.
const PER_GENERATION=4;

const q=(id,text,options)=>({id,text,options});
const QUESTIONS=[
  q('level','Comment décrirais-tu ton niveau ?',{beginner:'Je débute',intermediate:'Je joue déjà régulièrement',advanced:'Je suis à l’aise',professional:'La musique est mon métier'}),
  q('purpose','À quoi te servirait surtout la transcription ?',{learn:'Apprendre un morceau',practice:'Travailler un passage',teach:'Préparer un cours',create:'Composer ou arranger'}),
  q('source','Quel type d’audio veux-tu transcrire le plus souvent ?',{solo:'Un instrument seul',mix:'Des morceaux avec plusieurs instruments',voice:'Des morceaux avec du chant',own:'Mes propres enregistrements'}),
  q('main_instrument','Quel est ton instrument principal ?',{guitar:'Guitare',piano:'Piano',bass:'Basse',other:'Un autre instrument'}),
  q('years','Depuis combien de temps joues-tu ?',{under1:'Moins d’un an',y1_3:'1 à 3 ans',y3_10:'3 à 10 ans',over10:'Plus de 10 ans'}),
  q('frequency','À quelle fréquence joues-tu ?',{daily:'Tous les jours',weekly:'Plusieurs fois par semaine',sometimes:'De temps en temps',rarely:'Rarement'}),
  q('reading','Lis-tu la musique ?',{score:'Oui, la partition',tab:'Seulement la tablature',little:'Un peu',none:'Pas du tout'}),
  q('learning_method','Comment apprends-tu un morceau aujourd’hui ?',{ear:'À l’oreille',videos:'Avec des tutos vidéo',sheets:'Avec des partitions trouvées en ligne',teacher:'Avec un prof'}),
  q('lessons','Prends-tu des cours ?',{teacher:'Oui, avec un prof',online:'Oui, en ligne',self:'Non, j’apprends seul',teach:'C’est moi qui donne des cours'}),
  q('genre','Quel style joues-tu le plus ?',{pop_rock:'Pop, rock',urban:'Rap, R&B, urbain',classical_jazz:'Classique, jazz',chanson:'Variété, chanson'}),
  q('song_era','Tu joues plutôt des morceaux…',{recent:'Récents',classics:'Des années 80 à 2000',older:'Plus anciens',mixed:'Un peu de tout'}),
  q('finding_sheets','Trouves-tu facilement les partitions de tes morceaux ?',{always:'Oui, presque toujours',often_not:'Souvent pas',rarely:'Rarement',never:'Jamais pour ce que j’écoute'}),
  q('other_tools','Utilises-tu déjà un autre outil ?',{tab_sites:'Sites de tablatures',ai_apps:'Une autre appli d’IA',software:'Un logiciel de partition',none:'Aucun'}),
  q('paid_before','As-tu déjà payé pour une appli ou des partitions de musique ?',{subscribed:'Oui, j’ai un abonnement',once:'Oui, déjà',ready:'Jamais, mais je suis prêt',never:'Jamais'}),
  q('budget','Combien serais-tu prêt à payer par mois pour un outil comme Tablurio ?',{under5:'Moins de 5 €',e5_10:'5 à 10 €',e10_20:'10 à 20 €',over20:'Plus de 20 €'}),
  q('songs_per_month','Combien de morceaux voudrais-tu transcrire par mois ?',{m1_2:'1 ou 2',m3_5:'3 à 5',m6_15:'6 à 15',over15:'Plus de 15'}),
  q('scope','Tu travailles plutôt…',{passage:'Un passage précis',whole:'Le morceau entier',riff:'Un riff ou une intro',solo:'Les solos'}),
  q('priority','Qu’est-ce qui compte le plus pour toi ?',{accuracy:'Des notes exactes',playable:'Une version facile à jouer',rhythm:'Un rythme juste',speed:'Un résultat rapide'}),
  q('difficulty','Tu préfères une version…',{faithful:'Fidèle, même difficile',simple:'Simplifiée',both:'Les deux au choix',depends:'Ça dépend du morceau'}),
  q('device','Sur quel appareil utilises-tu Tablurio ?',{computer:'Ordinateur',tablet:'Tablette',phone:'Téléphone',several:'Plusieurs'}),
  q('reading_setup','Pendant que tu joues, ta partition est…',{screen:'Sur un écran à côté',printed:'Imprimée',stand:'Sur une tablette au pupitre',memory:'Dans ma tête'}),
  q('printing','Imprimes-tu tes partitions ?',{always:'Toujours',sometimes:'Parfois',rarely:'Rarement',never:'Jamais'}),
  q('listening','Quand tu écoutes un relevé, tu utilises surtout…',{slower:'La vitesse réduite',loop:'La boucle sur un passage',voice:'La voix isolée',nothing:'Rien de particulier'}),
  q('missing_feature','Quelle fonction te manque le plus ?',{loop:'Boucler un passage',chord_charts:'Les diagrammes d’accords',metronome:'Un métronome',transpose:'La transposition'}),
  q('transpose','Joues-tu souvent dans une autre tonalité que l’original ?',{often:'Souvent',sometimes:'Parfois',never:'Jamais',unsure:'Je ne sais pas'}),
  q('capo','Utilises-tu un capodastre ?',{often:'Souvent',sometimes:'Parfois',never:'Jamais',unknown:'C’est quoi ?'}),
  q('tuning','Dans quel accordage joues-tu ?',{standard:'Standard',drop_d:'Drop D',other:'D’autres accordages',unknown:'Je ne sais pas'}),
  q('export_format','Quel format de fichier te sert le plus ?',{pdf:'PDF',guitar_pro:'Guitar Pro',musicxml:'MusicXML ou MuseScore',midi:'MIDI'}),
  q('sharing','Partages-tu tes partitions ?',{band:'Avec mon groupe',students:'Avec mes élèves',friends:'Avec des amis',no:'Non'}),
  q('playing_with','Avec qui joues-tu ?',{band:'En groupe régulier',jams:'En jam ou entre amis',choir:'À l’église ou en chorale',alone:'Seul'}),
  q('goal','As-tu un objectif précis en ce moment ?',{gig:'Un concert',exam:'Un examen',fun:'Le plaisir',content:'Publier des covers'}),
  q('covers','Publies-tu des covers en ligne ?',{often:'Oui, régulièrement',sometimes:'Parfois',want:'Non, mais j’aimerais',no:'Non'}),
  q('discovery','Comment as-tu connu Tablurio ?',{search:'Recherche Google',social:'Réseaux sociaux',word:'Bouche-à-oreille',ad:'Une publicité'}),
  q('search_words','Que tapes-tu pour trouver une partition ?',{tab:'« tab » + le titre',sheet:'« partition » + le titre',chords:'« accords » + le titre',tutorial:'« tuto » + le titre'}),
  q('wait_ok','Combien de temps d’attente te paraît acceptable pour un relevé ?',{s30:'Moins de 30 secondes',m1:'Une minute',m3:'Trois minutes',any:'Peu importe s’il est bon'}),
  q('reliability','Les relevés de Tablurio te semblent…',{very:'Très fiables',fairly:'Plutôt fiables',average:'Moyens',not_yet:'Pas encore fiables'}),
  q('recommend','Recommanderais-tu Tablurio à un ami musicien ?',{sure:'Oui, sûrement',probably:'Probablement',maybe:'Peut-être',no:'Non'}),
  q('situation','Quelle est ta situation ?',{student:'Étudiant',working:'En activité',retired:'Retraité',musician:'Musicien professionnel'}),
  q('country','Où vis-tu ?',{france:'France',be_ch:'Belgique ou Suisse',canada:'Canada',elsewhere:'Ailleurs'}),
  q('language','Dans quelle langue préfères-tu utiliser l’outil ?',{fr:'Français',en:'Anglais',both:'Les deux me vont',other:'Une autre langue'}),
  q('guitar_notation','À la guitare, tu préfères…',{tab:'La tablature seule',tab_score:'Tablature et partition',chords:'La grille d’accords',score:'La partition'}),
  q('session_length','Combien de temps dure une séance de pratique ?',{under15:'Moins de 15 minutes',m15_30:'15 à 30 minutes',m30_60:'30 minutes à 1 heure',over60:'Plus d’une heure'}),
  q('obstacle','Qu’est-ce qui te freine le plus pour apprendre un morceau ?',{finding:'Trouver la partition',rhythm:'Comprendre le rythme',speed:'Jouer à la bonne vitesse',motivation:'La motivation'}),
  q('practice_audio','Tu préfères t’entraîner avec…',{original:'Le son original',transcription:'La transcription jouée',both:'Les deux',metronome:'Un métronome'}),
  q('next_instrument','Quel instrument aimerais-tu voir ensuite ?',{violin:'Violon',drums:'Batterie',bass:'Basse',ukulele:'Ukulélé'}),
  q('news','Veux-tu être prévenu des nouveautés ?',{email:'Oui, par email',in_app:'Oui, dans l’appli',rarely:'Seulement les grosses nouveautés',no:'Non merci'}),
  q('pricing','Quelle formule te convient le mieux ?',{monthly:'Abonnement mensuel',yearly:'Abonnement annuel',per_song:'Payer à l’unité',lifetime:'Un achat à vie'}),
  q('one_change','Si tu pouvais changer une chose sur Tablurio, ce serait…',{accuracy:'La précision',speed:'La rapidité',price:'Le prix',features:'Plus de fonctions'})
];

module.exports={QUESTIONS,PER_GENERATION};
