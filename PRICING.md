# SongToSheet.ai — Spécification des abonnements (V1)

**Statut :** Les pages `/tarifs` et `/upgrade` affichent les offres. Les abonnements ne sont pas encore ouverts à l’achat.

| Plan | Période | Prix total | Prix mensuel affiché | Usage |
|---|---|---:|---:|---|
| Essentiel | Mensuel | 10,00 € | 10,00 € | 1 transcription réussie sur 7 jours glissants |
| Essentiel | Annuel | 78,00 € | 6,50 € | même quota |
| Illimité | Mensuel | 19,00 € | 19,00 € | transcriptions illimitées avec usage raisonnable |
| Illimité | Annuel | 148,20 € | 12,35 € | même règle |
| À vie | Unique | 99,00 € | — | accès durable aux fonctions V1 avec usage raisonnable |

## UX

- Le parcours propose un aperçu gratuit de 30 secondes.
- Le lien « Voir les abonnements » dans le studio ouvre `/upgrade`. Les deux pages partagent la même comparaison et mettent en avant l’offre **Illimité**.
- Le mensuel est sélectionné à l’ouverture. L’annuel affiche l’équivalent mensuel, le montant facturé chaque année et l’économie sur douze mois. L’offre À vie coûte 99 € en un seul paiement.

## Entitlements à implémenter avant de vendre

1. Stocker plan, cycle, état Stripe, date de fin de période payée, historique des transactions et annulations dans une base durable.
2. Mettre en place Stripe Checkout (mode subscription pour mensuel/annuel ; payment pour vie), Customer Portal, signature des webhooks et idempotence.
3. Ne jamais accorder l'accès au retour de la page succès ; attendre une confirmation Stripe signée.
4. Essentiel : compteur atomique pour un enregistrement réussi maximum dans une fenêtre glissante de 7 jours ; les échecs ne consomment pas le quota ; pas de report.
5. Illimité/À vie : quotas d'usage raisonnable publiés avant lancement, limite de tâches simultanées pour prévenir l'abus.
6. En cas de résiliation, maintenir l'accès jusqu'à la fin de la période payée ; en cas de remboursement/chargeback, révoquer l'entitlement correspondant.
7. Prévoir TVA, factures, conditions de rétractation, politique de remboursement et politique d'utilisation raisonnable compatibles avec les clients français.
8. Remplacer l'ancien backend à crédits dans `backend/` avant toute activation des paiements d'abonnement.

## Risque économique

À 99 € à vie, l'offre se substitue à ~5,2 mois d'abonnement Illimité à 19 €/mois. Mesurer les coûts moyens par transcription et le comportement des utilisateurs avant d'activer ce prix ; une offre à vie illimitée peut devenir déficitaire.
