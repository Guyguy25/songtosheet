# SongToSheet.ai — Spécification des abonnements (V1)

**Statut :** Tarifs présentés dans la landing et le modal de démo, non commercialisables tant que l'entitlement backend et le paiement n'ont pas été intégrés et testés.

| Plan | Période | Prix total | Prix mensuel affiché | Usage |
|---|---|---:|---:|---|
| Essentiel | Mensuel | 10,00 € | 10,00 € | 1 transcription réussie sur 7 jours glissants |
| Essentiel | Annuel | 78,00 € | 6,50 € | même quota |
| Illimité | Mensuel | 19,00 € | 19,00 € | transcriptions illimitées avec usage raisonnable |
| Illimité | Annuel | 148,20 € | 12,35 € | même règle |
| À vie | Unique | 99,00 € | — | accès durable aux fonctions V1 avec usage raisonnable |

## UX

- Aucune période d'essai gratuite ni génération de transcription offerte.
- La landing et le dashboard affichent la même grille ; l'offre **Illimité** est recommandée et sélectionnée par défaut.
- Choix mensuel/annuel synchronisé entre la page et le modal ; l'accès à vie reste à 99 € quel que soit le choix.
- Le prix annuel **réellement débité** doit figurer avant paiement : 78,00 € ou 148,20 €.
- Le clic sur le CTA du modal dans la version publique n'ouvre aucun checkout ; un message informe clairement que les paiements ne sont pas actifs.

## Entitlements à implémenter avant de vendre

1. Stocker plan, cycle, état Stripe, date de fin de période payée, historique des transactions et annulations dans une base durable.
2. Mettre en place Stripe Checkout (mode subscription pour mensuel/annuel ; payment pour vie), Customer Portal, signature des webhooks et idempotence.
3. Ne jamais accorder l'accès au retour de la page succès ; attendre une confirmation Stripe signée.
4. Essentiel : compteur atomique pour un enregistrement réussi maximum dans une fenêtre glissante de 7 jours ; les échecs ne consomment pas le quota ; pas de report.
5. Illimité/À vie : limite de 6 minutes par morceau en V1, quotas d'usage raisonnable publiés avant lancement, limite de tâches simultanées pour prévenir l'abus.
6. En cas de résiliation, maintenir l'accès jusqu'à la fin de la période payée ; en cas de remboursement/chargeback, révoquer l'entitlement correspondant.
7. Prévoir TVA, factures, conditions de rétractation, politique de remboursement et politique d'utilisation raisonnable compatibles avec les clients français.
8. Remplacer l'ancien backend à crédits dans `backend/` avant toute activation des paiements d'abonnement.

## Risque économique

À 99 € à vie, l'offre se substitue à ~5,2 mois d'abonnement Illimité à 19 €/mois. Mesurer les coûts moyens par transcription et le comportement des utilisateurs avant d'activer ce prix ; une offre à vie illimitée peut devenir déficitaire.

**Important :** le site sur Vercel est une maquette interactive sans stockage des abonnements, sans paiements et sans génération IA réelle à partir des plateformes.
