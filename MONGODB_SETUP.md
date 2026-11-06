# Préparer MongoDB Atlas pour SongToSheet

Le site public est aujourd'hui une **démo sans authentification ni transcription réelle**. Ne pas connecter directement les données de démonstration à une base de production.

## Connexion du compte MongoDB existant

1. Depuis ChatGPT, connecter le plugin **MongoDB Atlas** à son compte Atlas pour inspecter ensemble les projets, clusters et collections. Cette connexion n'est pas automatiquement celle de l'application SongToSheet.
2. Pour connecter **le site SongToSheet hébergé sur Vercel**, utiliser soit l'intégration native MongoDB Atlas dans le Marketplace Vercel, soit un utilisateur MongoDB Atlas dédié à l'application.
3. Dans Vercel, rattacher le cluster au projet `songtosheet` et ajouter la variable serveur `MONGODB_URI` (l'intégration native peut le faire automatiquement). Ne **jamais** mettre l'URI ou son mot de passe dans `index.html`, des fichiers publics GitHub, des captures d'écran, ni dans un message de chat.
4. Configurer les permissions de cet utilisateur avec le minimum nécessaire, ainsi que les règles réseau Atlas adaptées à l'hébergement Vercel. La configuration native Vercel/Atlas prévoit des IP sortantes dynamiques ; examiner les implications de son autorisation réseau globale et les alternatives de réseau privé avant production.
5. Avant de rendre les vrais comptes accessibles, installer des endpoints serveur et une authentification vérifiée. Le mot de passe **fictif** du formulaire actuel n'est pas une authentification et ne doit pas être utilisé pour une véritable base de données.

## Modèle de données cible (à créer avec le cluster connecté)

```text
songtosheet
├── users
│   ├── _id
│   ├── email          (normalisé, unique)
│   ├── passwordHash   (Argon2id ou schéma d'identité éprouvé ; jamais le mot de passe brut)
│   └── createdAt
└── generations
    ├── _id
    ├── userId         (référence à users._id, non contrôlable par le client)
    ├── title
    ├── provider
    ├── instrument     (piano / guitare / violon / voix / basse)
    ├── format         (partition / tablature)
    ├── durationSeconds
    ├── status         (demo / pending / processing / completed / failed)
    ├── createdAt
    └── outputRefs     (uniquement lorsqu'un vrai traitement existe)
```

**Index recommandés** : `users.email` unique et `generations({userId:1,createdAt:-1})`. Les API de bibliothèque doivent toujours vérifier la session utilisateur **côté serveur** et filtrer les créations par `userId`.

## Comportement de la V1 actuelle

En attendant MongoDB et l'authentification réelle, une génération simulée terminée est sauvegardée dans `localStorage` au moment de l'inscription fictive, dans un espace séparé par adresse email. Elle peut être retrouvée depuis `Ma bibliothèque` puis rouverte comme aperçu illustratif **sur le même navigateur/appareil**. Seules les métadonnées de démo sont gardées (titre, source générique, durée, instrument, format, date) : **aucun audio, mot de passe ou fichier MIDI/PDF n'est conservé**. La valeur saisie dans le champ mot de passe n'est ni vérifiée ni persistée. Cela n'offre **aucune sécurité d'identité** : toute personne utilisant ce navigateur avec la même adresse email fictive peut ouvrir l'espace correspondant. Ne pas y enregistrer de données sensibles.

Un vrai compte synchronisé entre appareils nécessitera d'abord l'authentification réelle, puis la sauvegarde de ses générations dans MongoDB via les fonctions serveur. Ne pas migrer automatiquement les créations de démo non authentifiées vers de vrais comptes sans confirmation.
