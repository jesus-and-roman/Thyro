# Thyro — Connexion & Inscription

## Mise en place

1. **Base de données** : exécute `supabase/schema.sql` dans l'éditeur SQL de ton projet Supabase (`xxewxbcknthmffcykqxe`).
2. **Logo** : dépose ton logo dans `assets/img/logo2.svg` (ou `logo2.png` en secours). S'il est absent, le PDF de récupération est généré sans logo, pas d'erreur.
3. Héberge le dossier tel quel (Supabase Storage, GitHub Pages, ou ton hébergement habituel) — les fichiers `connexion.html` / `inscription.html` sont autonomes.

## Décisions techniques à connaître

- **Préfixe `thyro_` au lieu de `.thyro`** : un point n'est pas un identifiant Postgres valide sans le quoter partout (`"table.col"`), ce qui casserait PostgREST et les RLS. `thyro_` donne le même repérage visuel sans ce risque.
- **Pas de Supabase Auth** : comme tes autres projets (JFKforum, Claurc), l'authentification est 100 % maison — table `thyro_users` + fonctions `SECURITY DEFINER`. La table n'est **jamais** accessible directement par `anon` (RLS activé, aucune policy) ; tout passe par les fonctions RPC.
- **Sessions** : `thyro_login` crée une ligne dans `thyro_sessions` et renvoie un jeton stocké dans `localStorage`. Il n'y a pas encore de page "compte" qui vérifie ce jeton — à faire dans une prochaine étape.
- **Hachage** : mot de passe et NIP sont d'abord réduits en SHA-256 avant le bcrypt, pour éviter la troncature silencieuse de bcrypt au-delà de 72 octets (pertinent puisque le mot de passe n'a pas de longueur maximale).
- **Code de récupération (520 caractères)** : jamais stocké en clair, seulement son empreinte SHA-256. Il n'est visible qu'une seule fois, au moment du téléchargement du PDF.
- **Nom d'utilisateur** : aucune règle n'était précisée pour ce champ — j'ai choisi 3 à 20 caractères (lettres, chiffres, `.`, `_`, `-`). Dis-moi si tu veux autre chose.
- **NIP** : stocké haché, mais son usage n'est pas encore branché dans un flux (ton brief ne précise pas où il sert au-delà de l'inscription — probablement pour "J'ai oublié mon mot de passe" ou un futur second facteur).

## Pas encore fait (hors scope de cette demande)

- **J'ai oublié mon mot de passe** (email / SMS / fichier de récupération), avec la logique de rate-limit Supabase.
- **Rejoindre avec l'IP** — attention : la détection VPN/proxy/Tor/datacenter/mobile/réputation **ne peut pas se faire côté HTML seul sans service externe**. Seul le filtre bogon/réservé est faisable localement par calcul sur l'adresse. À en rediscuter avant de la construire.
- Page "compte" qui consomme le jeton de session.

## Structure des fichiers

```
thyro/
├── connexion.html
├── inscription.html
├── assets/
│   ├── css/thyro.css
│   ├── js/
│   │   ├── thyro-client.js       (init Supabase + validations partagées)
│   │   ├── thyro-connexion.js
│   │   └── thyro-inscription.js
│   └── img/                      (dépose logo2.svg ou logo2.png ici)
└── supabase/schema.sql
```
