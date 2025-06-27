# 📘 xcraft-core-transport

## Aperçu

Le module `xcraft-core-transport` fournit les backends de transport pour les modules `xcraft-core-bus` et `xcraft-core-busclient`. Il implémente une couche d'abstraction pour la communication inter-processus et réseau dans l'écosystème Xcraft, supportant plusieurs protocoles de transport (EventEmitter local, Axon TCP/TLS/Unix sockets) avec des fonctionnalités avancées comme le streaming de données, le routage intelligent et la gestion des certificats TLS.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)

## Structure du module

Le module s'organise autour de plusieurs composants principaux :

- **Router** : Gestionnaire central de routage et d'orchestration des communications
- **Backends** : Implémentations spécifiques des protocoles de transport (Axon, EventEmitter)
- **Cache** : Système de mise en cache optimisé pour les expressions régulières de routage
- **Streamer** : Gestionnaire de flux de données pour le transfert de fichiers
- **Helpers** : Utilitaires de sérialisation et manipulation des messages

## Fonctionnement global

Le transport Xcraft fonctionne selon une architecture modulaire avec plusieurs couches :

### Architecture de routage

Le système utilise une table ARP (Address Resolution Protocol) pour maintenir les routes vers les différents orcs (acteurs) du système. Chaque orc est identifié par un nom unique et peut être accessible via différents backends de transport.

### Modes de communication

- **Push/Pull** : Communication point-à-point pour les commandes
- **Pub/Sub** : Communication broadcast pour les événements
- **Streaming** : Transfert de fichiers et données volumineuses

### Gestion des lignes (Lines)

Le système maintient des "lignes" qui représentent les connexions logiques entre les acteurs. Ces lignes permettent un routage optimisé des messages vers les destinataires appropriés.

## Exemples d'utilisation

### Configuration basique d'un routeur

```javascript
const Router = require('xcraft-core-transport').Router;
const xLog = require('xcraft-core-log')('transport', null);

// Création d'un routeur serveur pour les événements
const eventRouter = new Router('server-1', 'pub', xLog);

// Démarrage du serveur
eventRouter.start(
  {
    host: '127.0.0.1',
    port: 3000,
    timeout: 30000,
  },
  () => {
    console.log("Serveur d'événements démarré");
  }
);

// Création d'un client pour recevoir les événements
const clientRouter = new Router('client-1', 'sub', xLog);
clientRouter.connect(
  'axon',
  {
    host: '127.0.0.1',
    port: 3000,
  },
  () => {
    // Souscription à un topic
    clientRouter.subscribe('my-actor::*');

    // Écoute des messages
    clientRouter.on('message', (topic, data) => {
      console.log(`Reçu: ${topic}`, data);
    });
  }
);
```

### Utilisation des commandes de transport

```javascript
// Affichage de la table ARP
const busClient = require('xcraft-core-busclient').getGlobal();
const resp = busClient.newResponse('transport', 'token');

resp.command.send('transport.arp', {}, (err, result) => {
  if (!err) {
    console.log('Table ARP affichée dans les logs');
  }
});

// Vérification du statut des transports
resp.command.send('transport.status', {}, (err, status) => {
  if (!err) {
    console.log('Statut des transports:', status);
  }
});
```

### Streaming de fichiers

```javascript
const fs = require('fs');

// Envoi d'un fichier
const message = {
  _xcraftMessage: true,
  data: {
    xcraftUpload: fs.createReadStream('/path/to/file.txt'),
    streamId: 'my-unique-stream-id',
  },
};

router.send('file-transfer', message);

// Réception d'un stream
router.on('message', (topic, data) => {
  if (data.xcraftStream) {
    const writeStream = fs.createWriteStream('/path/to/output.txt');
    data.xcraftStream.streamer(
      'destination',
      writeStream,
      (current, total) => {
        console.log(`Progression: ${current}/${total}`);
      },
      (err) => {
        if (err) {
          console.error('Erreur de transfert:', err);
        } else {
          console.log('Transfert terminé');
        }
      }
    );
  }
});
```

## Interactions avec d'autres modules

Le module `xcraft-core-transport` interagit étroitement avec :

- **[xcraft-core-bus]** : Fournit l'infrastructure de transport pour le bus de commandes
- **[xcraft-core-busclient]** : Utilise les transports pour les connexions client
- **[xcraft-core-etc]** : Récupère la configuration des transports
- **[xcraft-core-host]** : Obtient les informations d'identification et de routage
- **[xcraft-core-horde]** : Gère les connexions multi-instances
- **[xcraft-core-probe]** : Collecte les métriques de performance des transports

## Configuration avancée

| Option              | Description                              | Type    | Valeur par défaut        |
| ------------------- | ---------------------------------------- | ------- | ------------------------ |
| `backends`          | Liste des backends activés (vide = tous) | Array   | `[]`                     |
| `axon.clientOnly`   | Mode client uniquement pour Axon         | Boolean | `false`                  |
| `requestClientCert` | Demander les certificats clients         | Boolean | `false`                  |
| `certsPath`         | Emplacement des certificats clients      | String  | `{xcraftRoot}/var/certs` |
| `keysPath`          | Emplacement des clés privées             | String  | `{xcraftRoot}/var/keys`  |

## Détails des sources

### `transport.js`

Expose les commandes Xcraft pour l'administration et le monitoring des transports. Fournit des commandes pour afficher la table ARP, les lignes de connexion, le statut des transports et les métriques système.

#### Commandes publiques

- **`arp`** — Affiche la table ARP avec les routes vers tous les orcs connectés
- **`arp.hordes`** — Affiche la répartition des hordes dans la table ARP
- **`lines`** — Affiche les lignes de connexion actives avec leurs compteurs de référence
- **`status`** — Affiche le statut détaillé de tous les routeurs de transport
- **`emit-chunk`** — Émet un chunk de données dans le système de streaming
- **`emit-end`** — Signale la fin d'un stream
- **`start-emit`** — Démarre l'émission d'un stream
- **`xcraftMetrics`** — Extrait les métriques Xcraft pour le monitoring

### `lib/index.js`

Point d'entrée principal du module qui expose les classes et utilitaires principaux. Gère un registre global des routeurs et fournit une version wrappée de la classe Router qui s'auto-enregistre.

### `lib/router.js`

Cœur du système de routage qui orchestre la communication entre les différents backends de transport. Gère la table ARP, les lignes de connexion, le routage des messages et l'intégration avec les systèmes de streaming.

#### État et modèle de données

Le routeur maintient plusieurs structures de données critiques :

- **Table ARP** : Mapping des noms d'orcs vers leurs informations de connexion
- **Lignes locales/distantes** : Gestion des connexions logiques entre acteurs
- **Queues de messages** : Files d'attente pour les messages en attente de routage

#### Méthodes publiques

- **`start(options, callback)`** — Démarre le routeur avec les options spécifiées
- **`stop()`** — Arrête proprement le routeur et ferme toutes les connexions
- **`connect(backend, options, callback)`** — Connecte le routeur à un backend spécifique
- **`send(topic, ...args)`** — Envoie un message via le routeur
- **`subscribe(topic, backend, orcName)`** — Souscrit à un topic spécifique
- **`unsubscribe(topic, backend, orcName)`** — Se désinscrit d'un topic
- **`on(topic, handler, proxy)`** — Écoute les événements du routeur
- **`status()`** — Retourne le statut actuel du routeur

#### Méthodes statiques de gestion des routes

- **`deleteRoute(orcName, backend)`** — Supprime une route de la table ARP
- **`updateLines(lines, token, generation, horde)`** — Met à jour les lignes de connexion
- **`connectLine(lineId, orcName)`** — Établit une connexion logique
- **`disconnectLine(lineId, orcName)`** — Ferme une connexion logique
- **`moveRoute(oldOrcName, newOrcName)`** — Déplace une route (utilisé pour l'autoconnect)

### `lib/cache.js`

Système de cache optimisé pour les expressions régulières utilisées dans le routage des messages. Utilise une approche basée sur l'extraction d'IDs pour améliorer les performances de matching.

#### Méthodes publiques

- **`matches(topic)`** — Vérifie si un topic correspond à au moins une regex en cache
- **`map(topic, predicate)`** — Applique une fonction de mapping sur les correspondances
- **`set(id, key, value)`** — Ajoute une regex au cache
- **`del(id, key)`** — Supprime une regex du cache
- **`clear()`** — Vide complètement le cache

### `lib/helpers.js`

Utilitaires pour la sérialisation/désérialisation des messages Xcraft, la gestion des streams et l'extraction d'identifiants depuis les topics.

#### Fonctions principales

- **`extractIds(topic)`** — Extrait les identifiants d'un topic pour optimiser le cache
- **`extractLineId(topic)`** — Extrait l'ID de ligne d'un topic
- **`toXcraftJSON(args, newStreamer)`** — Sérialise les arguments en format Xcraft JSON
- **`fromXcraftJSON(args, newStreamer)`** — Désérialise depuis le format Xcraft JSON
- **`dataToXcraftJSON(data)`** — Convertit les données Immutable/Shredder en JSON
- **`dataFromXcraftJSON(data)`** — Restaure les données depuis le JSON Xcraft

### `lib/streamer.js`

Gestionnaire de flux de données pour le transfert de fichiers et streams volumineux à travers le réseau Xcraft.

#### Fonctionnalités

- Transfert de fichiers avec progression
- Gestion des timeouts (120 secondes par défaut)
- Support des uploads et downloads
- Intégration avec le système d'événements Xcraft

#### Méthodes publiques

- **`receive(remoteRoutingKey, stream, progress, next)`** — Reçoit un stream depuis un routeur distant

### `lib/backends/axon.js`

Backend de transport basé sur la bibliothèque Axon, supportant TCP, TLS et Unix sockets pour la communication réseau.

#### Fonctionnalités avancées

- Support TLS avec certificats client/serveur
- Unix sockets pour les communications locales haute performance
- Gestion automatique des certificats avec surveillance des fichiers
- Détection automatique des réseaux privés
- Gestion des inodes pour les Unix sockets

#### Méthodes publiques

- **`connect(options, callback)`** — Établit une connexion client
- **`start(options, callback)`** — Démarre le serveur
- **`send(topic, streamChannel, ...args)`** — Envoie un message
- **`sendTo(port, topic, streamChannel, ...args)`** — Envoie vers un port spécifique
- **`subscribe(re, ids)`** — Souscrit à des patterns de messages
- **`refreshCerts()`** — Recharge les certificats TLS dynamiquement

### `lib/backends/ee.js`

Backend de transport basé sur EventEmitter pour les communications locales haute performance au sein du même processus.

#### Caractéristiques

- Communication synchrone ultra-rapide
- Partage d'EventEmitter entre instances
- Cache intégré pour l'optimisation des souscriptions
- Gestion automatique du cycle de vie des connexions

#### Méthodes publiques

- **`connect(options, callback)`** — Connecte à un EventEmitter partagé
- **`start(options, callback)`** — Démarre le backend EventEmitter
- **`send(topic, streamChannel, ...args)`** — Émet un message local
- **`subscribe(re, ids)`** — Souscrit à des patterns locaux
- **`unsubscribe(re)`** — Se désinscrit d'un pattern

---

_Ce document a été mis à jour pour refléter l'état actuel du code source._

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-horde]: https://github.com/Xcraft-Inc/xcraft-core-horde
[xcraft-core-probe]: https://github.com/Xcraft-Inc/xcraft-core-probe