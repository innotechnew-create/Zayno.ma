# ZAYNO Marketplace — Version 1.2

Version 1.2 consolide le prototype 1.1 : authentification, sessions, création contrôlée du premier administrateur, téléversement Cloudinary, sauvegarde JSON atomique, validations et tests API.

> **Statut : version de préproduction.** Les tests automatisés et la configuration locale doivent être exécutés sur le Mac. Le lancement public nécessite une base de données transactionnelle (PostgreSQL), une politique de sauvegarde, la configuration du stockage externe et une revue juridique/sécurité. Le stockage JSON reste réservé au développement et à la migration locale ; ne pas faire fonctionner plusieurs instances applicatives dessus.

## Prérequis
- Node.js 20 ou supérieur
- npm
- Un compte Cloudinary pour les images (gratuit pour commencer, selon quotas et conditions)

## Installation sur macOS
Depuis le dossier du projet :

```bash
npm install
cp .env.example .env
```

Générez un secret de session :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copiez le résultat dans `SESSION_SECRET` dans `.env`. Pour Cloudinary, renseignez `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` et `CLOUDINARY_API_SECRET` depuis le tableau de bord Cloudinary. Ne partagez jamais le fichier `.env`.

Démarrez le serveur :

```bash
npm run dev
```

Ouvrez http://localhost:3000.

## Création sécurisée du premier administrateur
1. Créez d'abord un compte client depuis la boutique si vous souhaitez tester l'inscription.
2. Pour créer le véritable compte admin, arrêtez le serveur avec `Control + C`.
3. Dans `.env`, définissez temporairement `ADMIN_INITIAL_PASSWORD` avec au moins 14 caractères.
4. Exécutez :

```bash
npm run admin:create -- admin@zayno.ma "Administrateur ZAYNO"
```

5. Retirez immédiatement `ADMIN_INITIAL_PASSWORD` du fichier `.env`.
6. Redémarrez le serveur et connectez-vous sur http://localhost:3000/admin.html.

La commande n'expose aucune route publique de promotion en administrateur et refuse d'écraser une adresse existante.

## Images produits
L'administration accepte JPG, PNG, WEBP et AVIF, jusqu'à 5 Mo par image. Les images sont envoyées vers Cloudinary ; seul leur URL HTTPS est conservé dans les données du produit. Sans les trois variables Cloudinary, le téléversement est volontairement désactivé. Les anciens produits peuvent continuer à utiliser leur emoji.

## Données locales
Les données de démonstration sont dans `data/store.json` et les sessions SQLite dans `data/sessions.sqlite`. Une sauvegarde atomique est utilisée pour réduire le risque de fichier JSON partiellement écrit. Cela ne remplace pas PostgreSQL et n'offre pas de transactions multi-instance.

Avant migration, sauvegardez le dossier `data/`. Ne supprimez pas le fichier existant : il peut contenir des comptes, commandes ou produits utiles.

## Tests
```bash
npm test
```

Les tests couvrent la santé API, le catalogue, inscription, session, doublon d'e-mail, déconnexion et protection admin. Ils ne remplacent pas les tests navigateur, tests de paiement, tests de charge ou audit de sécurité.

## Préparation Render
Pour la préproduction sur Render :
- Build command : `npm install`
- Start command : `npm start`
- Runtime : Node.js 20+
- `NODE_ENV=production`
- `SESSION_SECRET` : secret aléatoire d'au moins 32 caractères
- `BASE_URL` : URL HTTPS finale
- Variables Cloudinary : les trois valeurs indiquées plus haut
- Pour conserver le JSON et SQLite en phase de test seulement, attacher un Persistent Disk et définir `DATA_DIR=/var/data` (une seule instance).

**Important :** pour une vraie marketplace, migrer utilisateurs, produits, commandes, promotions et sessions vers PostgreSQL avant ouverture publique. Le disque persistant Render est une étape de transition mono-instance, pas une architecture multi-instance. Ne pas déployer cette version avec stockage JSON sur le disque éphémère.

## Paiement
Le paiement à la livraison est le seul flux activé par défaut. Le flux Stripe est facultatif et ne doit pas être activé sans validation de l'éligibilité du marchand au Maroc, vérification du support MAD, configuration webhook HTTPS et tests sandbox complets. Aucun numéro de carte ou CVV ne doit être collecté par ZAYNO.

## Points à finaliser avant ouverture au public
- Migration PostgreSQL et sauvegardes restaurables.
- Tests réels sur Mac et Render, y compris sessions/cookies derrière proxy.
- Paramètres Cloudinary et règles de suppression des images.
- Vérification de toutes les routes admin et parcours de commande sur navigateur/mobile.
- Prestataire de paiement marocain agréé si paiement carte souhaité.
- CGV, confidentialité, livraison, retours, contact et conformité marocaine (dont obligations applicables aux données personnelles).
- Test de charge, monitoring, journalisation et plan de reprise.
