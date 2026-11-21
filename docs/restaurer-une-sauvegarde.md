# Restaurer une sauvegarde de la base

Les sauvegardes sont faites chaque nuit par le workflow « Sauvegarde de la base » (GitHub Actions)
et gardées 30 jours. Chaque sauvegarde est vérifiée : elle est restaurée dans une base temporaire
et le nombre de documents est comparé à l'original.

1. Sur GitHub : Actions → « Sauvegarde de la base » → la nuit voulue → télécharge l'artefact
   `tablurio-AAAA-MM-JJ.archive.gz.enc` (un zip qui contient le fichier).
2. Déchiffre-le avec la phrase secrète `BACKUP_PASSPHRASE` :
   `openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in tablurio-AAAA-MM-JJ.archive.gz.enc -out sauvegarde.archive.gz`
3. Restaure-la (outils MongoDB installés) :
   `mongorestore --uri="<adresse MongoDB>" --archive=sauvegarde.archive.gz --gzip --drop`
   Sans `--drop`, les documents existants sont gardés et seuls les manquants sont ajoutés.

Conseil : restaure d'abord dans une base de test (`--nsFrom="<base>.*" --nsTo="test.*"`) pour vérifier.
