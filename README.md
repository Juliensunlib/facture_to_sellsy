## Prérequis

- Node.js 18 ou supérieur
- Un compte Airtable avec une base contenant les tables suivantes:
  - `Abonnements`
  - `service_sellsy`
- Un compte Sellsy avec accès API V2
- Un compte GitHub pour l'automatisation

## Configuration

1. Créez les clés API nécessaires:
   - Airtable API Key
   - Sellsy Client ID et Client Secret

2. Configurez les secrets GitHub:
   - `AIRTABLE_API_KEY`
   - `AIRTABLE_BASE_ID`
   - `SELLSY_CLIENT_ID`
   - `SELLSY_CLIENT_SECRET`

3. Si vous exécutez en local, créez un fichier `.env` avec ces mêmes variables.

## Structure des tables Airtable

### Table `Abonnements`
- `ID_Sellsy_abonné`: ID du client dans Sellsy
- `Nom de l'abonnement`: Nom de l'abonnement
- `Statut`: État de l'abonnement (doit être "Actif" pour générer des factures)
- `Jour de facturation`: Jour du mois (1-31) pour générer la facture
- `Services liés`: Lien vers les services associés
- `Date de début`: Date de début de l'abonnement

### Table `service_sellsy`
- `Nom du service`: Description du service
- `Prix HT`: Prix du service
- `Taux TVA`: Taux de TVA applicable
- `ID_Sellsy_abonné`: Identifiant du client dans Sellsy
- `ID Sellsy`: Identifiant du service dans Sellsy
- `Occurrences restantes`: Nombre de facturation restantes
- `Occurrences totales`: Nombre total de facturations prévues
- `Mois facturés`: Nombre de mois déjà facturés
- `Catégorie`: Type de service (doit être "Abonnement")
- `Actif`: État du service (doit être "Actif" pour générer des factures)

## Fonctionnement

1. Le workflow GitHub Actions s'exécute tous les jours à 1h du matin
2. Le script vérifie tous les abonnements actifs
3. Pour chaque abonnement, il vérifie si la date du jour correspond au jour de facturation configuré
4. Si oui, il génère une facture pour chaque service associé avec le statut "Actif"
5. La facture est configurée avec GoCardless comme méthode de paiement
6. Le script met à jour le compteur d'occurrences restantes pour chaque service

## Développement local

```bash
# Installation des dépendances
npm install

# Exécution locale
npm start
```

## Mise en production

Il suffit de pousser le code vers votre dépôt GitHub avec les secrets configurés.
Le workflow s'exécutera automatiquement selon le planning défini.

---

Pour toute question ou assistance, veuillez contacter [votre contact].
