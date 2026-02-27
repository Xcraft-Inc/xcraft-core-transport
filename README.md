# 📘 xcraft-core-transport

## Aperçu

Le module `xcraft-core-transport` fournit les backends de transport pour les modules [`xcraft-core-bus`] et [`xcraft-core-busclient`]. Il implémente une couche d'abstraction pour la communication inter-processus et réseau dans l'écosystème Xcraft, supportant plusieurs protocoles de transport (EventEmitter local, Axon TCP/TLS/Unix sockets) avec des fonctionnalités avancées comme le streaming de données, le routage intelligent et la gestion des certificats TLS.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module s'organise autour de plusieurs composants principaux :

- **Router** (`lib/router.js`) : Gestionnaire central de routage et d'orchestration des communications, maintient la table ARP et les lignes de connexion.
- **Backends** (`lib/backends/`) : Implémentations spécifiques des protocoles de transport — `axon.js` pour TCP/TLS/Unix sockets et `ee.js` pour EventEmitter local.
- **Cache** (`lib/cache.js`) : Système de mise en cache optimisé pour les expressions régulières de routage.
- **Streamer** (`lib/streamer.js`) : Gestionnaire de flux de données pour le transfert de fichiers et streams volumineux.
- **Helpers** (`lib/helpers.js`) : Utilitaires de sérialisation, désérialisation et manipulation des messages Xcraft.
- **transport.js** : Exposition des commandes Xcraft pour l'administration et le monitoring.

## Fonctionnement global

Le transport Xcraft fonctionne selon une architecture modulaire avec plusieurs couches :

### Architecture de routage

Le système utilise une table ARP (Address Resolution Protocol) pour maintenir les routes vers les différents orcs (acteurs) du système. Chaque orc est identifié par un nom unique (`orcName`) et peut être accessible via les backends `axon` ou `ee`. La table ARP stocke pour chaque orc : son identifiant, token, socket, port, liste de hordes et indicateurs de configuration.

```
arp = {
  ee: { [orcName]: { id, token, socket, port, hordes, noForwarding, nodeName } },
  axon: { [orcName]: { id, token, socket, port, hordes, noForwarding, nodeName } }
}
```

### Modes de communication

- **Push/Pull** : Communication point-à-point pour les commandes (le client `push` envoie au serveur `pull`).
- **Pub/Sub** : Communication broadcast ou routée pour les événements (le serveur `pub` diffuse aux clients `sub`).
- **Streaming** : Transfert de fichiers et données volumineuses via le `Streamer`.

### Gestion des lignes (Lines)

Le système maintient des "lignes" représentant les connexions logiques entre acteurs, réparties en trois catégories :

- **local** : Lignes locales (`greathall::`) gérées en mémoire avec Immutable.js.
- **remotes** : Lignes distantes synchronisées depuis le warehouse.
- **pending** : Lignes en attente de mise à jour — les messages à destination de ces lignes sont mis en queue jusqu'à réception des nouvelles tables.

Un numéro de `generation` permet d'éviter les mises à jour obsolètes.

### Flux de routage des messages (pub)

```
send(topic, msg)
  └─ _pub(topic, msg)
       ├─ Forwarding appId ? → chercher dans ARP par hordes
       ├─ lineId présent ? → résoudre via lines.local / lines.remotes
       │    └─ pending ? → mettre en queue
       ├─ arpEntries trouvées → sendTo(port, backend)
       └─ aucune entrée → broadcast sur tous les backends
```

### Streaming de données

Le `Streamer` gère les transferts en deux modes :

- **Envoi** : souscrit à `stream.started.<streamId>` puis pipe le stream source par chunks via `emit-chunk`.
- **Réception** : souscrit à `stream.chunked.<streamId>` et `stream.ended.<streamId>`, écrit dans le stream destination.

Un timeout de 120 secondes est appliqué côté réception et se rafraîchit à chaque chunk reçu.

## Exemples d'utilisation

### Configuration d'un routeur push/pull (commandes)

```javascript
const {Router} = require('xcraft-core-transport');
const xLog = require('xcraft-core-log')('transport', null);

// Serveur de commandes
const server = new Router('server-1', 'pull', xLog);
server.on('message', (topic, msg) => {
  console.log(`Commande reçue: ${topic}`, msg);
});
server.start({host: '127.0.0.1', port: 3334}, () => {
  console.log('Serveur démarré');
});

// Client de commandes
const client = new Router('client-1', 'push', xLog);
client.connect('axon', {host: '127.0.0.1', port: 3334}, () => {
  client.send('my-command', {_xcraftMessage: true, data: {foo: 'bar'}});
});
```

### Configuration d'un routeur pub/sub (événements)

```javascript
const {Router} = require('xcraft-core-transport');
const xLog = require('xcraft-core-log')('transport', null);

// Serveur d'événements
const pubRouter = new Router('server-1', 'pub', xLog);
pubRouter.start({host: '127.0.0.1', port: 3335}, () => {
  pubRouter.send('my-actor::event-name', {_xcraftMessage: true, data: {}});
});

// Client d'événements
const subRouter = new Router('client-1', 'sub', xLog);
subRouter.subscribe('my-actor::*');
subRouter.on('message', (topic, msg) => {
  console.log(`Événement: ${topic}`, msg);
});
subRouter.connect('axon', {host: '127.0.0.1', port: 3335}, () => {});
```

### Utilisation des commandes de transport (monitoring)

```javascript
// Affichage de la table ARP via le bus Xcraft
const busClient = require('xcraft-core-busclient').getGlobal();
const resp = busClient.newResponse('transport', 'token');

// Voir la table ARP
resp.command.send(`${appId}.arp`, {}, (err) => {
  // La table ARP est affichée dans les logs
});

// Voir le statut de tous les routeurs
resp.command.send(`${appId}.status`, {}, (err, status) => {
  console.log('Statut:', status);
});

// Extraire les métriques Xcraft
resp.command.send('transport.xcraftMetrics', {}, (err, metrics) => {
  console.log('Métriques:', metrics);
});
```

### Connexion avec TLS

```javascript
const client = new Router('client-1', 'push', xLog);
client.connect(
  'axon',
  {
    host: 'remote-server.example.com',
    port: 3334,
    caPath: '/path/to/ca.pem', // Active TLS
    keyPath: '/path/to/client.key', // Optionnel: certificat client
    certPath: '/path/to/client.pem',
  },
  () => {
    console.log('Connecté via TLS');
  }
);
```

## Interactions avec d'autres modules

Le module `xcraft-core-transport` interagit étroitement avec :

- **[xcraft-core-bus]** : Fournit l'infrastructure de transport pour le bus de commandes ; le Router utilise `xcraft-core-bus` pour récupérer le token d'authentification et publier les événements de routage.
- **[xcraft-core-busclient]** : Utilise les transports pour les connexions client ; le `Streamer` et le `Router` l'utilisent pour envoyer des commandes et événements de streaming.
- **[xcraft-core-etc]** : Charge la configuration du module (`xcraft-core-transport`) pour déterminer les backends activés et les options TLS.
- **[xcraft-core-host]** : Fournit `appId`, `appMasterId` et `getRoutingKey()` pour le routage applicatif et la gestion des hordes.
- **[xcraft-core-horde]** : Intégration optionnelle pour gérer les connexions multi-instances (slaves) dans la table ARP.
- **[xcraft-core-probe]** : Collecte les métriques de performance des opérations de transport (push, pub, subscribe).
- **[xcraft-core-utils]** : Utilitaires regex pour la conversion des patterns de topics en expressions régulières.
- **[xcraft-core-shredder]** : Utilisé par les helpers pour sérialiser/désérialiser les payloads de type `Shredder`.

## Configuration avancée

| Option              | Description                                                   | Type    | Valeur par défaut        |
| ------------------- | ------------------------------------------------------------- | ------- | ------------------------ |
| `backends`          | Liste des backends activés (vide = tous)                      | Array   | `[]`                     |
| `axon.clientOnly`   | Mode client uniquement pour Axon (désactive l'écoute serveur) | Boolean | `false`                  |
| `requestClientCert` | Demander les certificats clients TLS                          | Boolean | `false`                  |
| `certsPath`         | Emplacement des certificats clients                           | String  | `{xcraftRoot}/var/certs` |
| `keysPath`          | Emplacement des clés privées clients                          | String  | `{xcraftRoot}/var/keys`  |

### Variables d'environnement

Ce module n'utilise pas de variables d'environnement directement. La configuration passe par [`xcraft-core-etc`] et [`xcraft-core-host`].

## Détails des sources

### `transport.js`

Expose les commandes Xcraft sur le bus pour l'administration et le monitoring des transports. Le namespace des commandes est construit dynamiquement à partir de `appId` et du `tribe` courant (ex: `myapp.arp`, `myapp-tribe1.status`).

#### Commandes publiques

- **`{appId}.arp`** — Affiche la table ARP complète (backend, orcName, id, token, port, hordes) dans les logs.
- **`{appId}.arp.hordes`** — Affiche la répartition des hordes dans la table ARP avec représentation visuelle des longueurs.
- **`{appId}.lines`** — Affiche les lignes de connexion actives avec leurs compteurs de référence par orc.
- **`{appId}.status`** — Affiche le statut détaillé de tous les routeurs (mode, backends actifs, souscriptions).
- **`{appId}.emit-chunk`** — Émet un chunk de données dans le système de streaming (utilisé par le `Streamer`).
- **`{appId}.emit-end`** — Signale la fin d'un stream.
- **`{appId}.start-emit`** — Démarre l'émission d'un stream avec la routing key de destination.
- **`xcraftMetrics`** — Extrait les métriques Xcraft pour le monitoring (taille ARP, lignes, sockets, bytes read/written).

### `lib/index.js`

Point d'entrée principal du module. Expose les classes et utilitaires principaux, et gère un registre global (`registry`) des routeurs instanciés. La classe `WrappedRouter` étend `Router` pour s'auto-enregistrer dans ce registre à la construction et se désenregistrer à l'arrêt.

Exports principaux :

- `helpers` — Instance des utilitaires de sérialisation.
- `Cache` — Classe de cache pour les expressions régulières.
- `Router` — Classe `WrappedRouter` avec gestion du registre.
- `getRouters()` — Retourne la liste plate de tous les routeurs actifs.

### `lib/router.js`

Cœur du système de routage qui orchestre la communication entre les différents backends de transport. Charge dynamiquement les backends disponibles depuis `lib/backends/` en filtrant selon la configuration.

#### Tables de données globales

- **`arp`** : Table ARP partagée entre toutes les instances de Router, indexée par backend (`ee`, `axon`) puis par `orcName`.
- **`lines`** : Lignes logiques avec `local` (Immutable Map), `remotes` (Map par horde), `pending` (Map lineId→generation) et `generation` courant.
- **`routers`** : Registre des routeurs par id et mode, partagé avec `WrappedRouter`.

#### Méthodes publiques d'instance

- **`start(options, callback)`** — Démarre le routeur sur tous les backends configurés. Accepte `host`, `port`, `unixSocketId`, `timeout`, `keyPath`, `certPath`, `serverKeepAlive`.
- **`stop()`** — Arrête proprement le routeur et ferme toutes les connexions backend.
- **`connect(backend, options, callback)`** — Connecte le routeur à un backend spécifique en mode client (`push` ou `sub`).
- **`send(topic, ...args)`** — Envoie un message via le routeur (délègue à `_push` en mode connecté, ou `_pub` en mode serveur).
- **`subscribe(topic, backend, orcName)`** — Souscrit à un topic avec gestion automatique des lignes. Retourne `{ids, str, reg}`.
- **`unsubscribe(topic, backend, orcName)`** — Se désinscrit d'un topic et met à jour les lignes si nécessaire.
- **`on(topic, handler, proxy=false)`** — Écoute les événements sur tous les backends.
- **`hook(topic, handler)`** — Enregistre un handler pour un topic interne du routeur (`message`, `error`, `disconnect`, etc.).
- **`status()`** — Retourne l'état courant : backends, options, mode, `connectedWith`.
- **`acceptIncoming()`** — Autorise les nouvelles connexions entrantes (utile après une phase d'initialisation).
- **`onInsertOrc(handler)`** — Écoute l'insertion d'un nouvel orc dans la table ARP.
- **`onDeleteOrc(handler)`** — Écoute la suppression d'un orc de la table ARP.
- **`connectedWith()`** — Retourne le nom du backend actuellement utilisé pour la connexion client.
- **`destroySockets()`** — Détruit tous les sockets ouverts sur tous les backends.

#### Méthodes statiques

- **`deleteRoute(orcName, backend)`** — Supprime une route de la table ARP (et supprime aussi l'entrée `ee` si backend est `axon`).
- **`updateLines(_lines, _token, generation, horde)`** — Met à jour les lignes distantes et traite les messages en queue pour les lignes qui n'étaient plus en attente.
- **`connectLine(lineId, orcName)`** — Établit une connexion logique (locale ou via `warehouse.request-line-update`).
- **`disconnectLine(lineId, orcName)`** — Ferme une connexion logique.
- **`moveRoute(oldOrcName, newOrcName)`** — Déplace une route lors de l'autoconnect (renommage d'orc temporaire → définitif).
- **`getRoute(orcName, backend)`** — Récupère une entrée ARP.
- **`getRouters(orcName, backend)`** — Retourne le groupe de routeurs associé à une route.
- **`getARP()`** — Retourne la table ARP globale.
- **`getLines()`** — Retourne l'objet `lines` global.
- **`getNice(orcName, backend)`** — Retourne la priorité (`nice`) d'un orc.
- **`extractLineId(topic)`** — Extrait l'ID de ligne d'un topic (délègue aux helpers).

### `lib/cache.js`

Système de cache optimisé pour les expressions régulières utilisées dans le routage des messages. Au lieu de tester toutes les regex sur chaque topic, le cache extrait d'abord les IDs présents dans le topic (via `extractIds`) pour ne tester que les regex associées à ces IDs spécifiques, réduisant drastiquement le nombre de comparaisons.

#### Méthodes publiques

- **`matches(topic)`** — Vérifie si le topic correspond à au moins une regex en cache. Retourne `true` si une correspondance est trouvée.
- **`map(topic, predicate)`** — Collecte et retourne les valeurs mappées par le prédicat pour toutes les regex qui correspondent au topic.
- **`set(id, key, value)`** — Ajoute une regex (`value`) au cache sous la clé `id` (extrait du topic) et `key` (généralement `regex.toString()`).
- **`del(id, key)`** — Supprime une entrée du cache. Si l'ID n'a plus d'entrées, il est supprimé.
- **`clear()`** — Vide complètement le cache.

### `lib/helpers.js`

Utilitaires pour la sérialisation/désérialisation des messages Xcraft avec support des types spéciaux (Immutable.js, Shredder), la gestion des streams et l'extraction d'identifiants depuis les topics.

Le cache interne `idsCache` limite sa taille à 4096 entrées (suppression par lot de 128) pour éviter les fuites mémoire.

#### Fonctions principales

- **`extractIds(topic)`** — Extrait et ordonne les identifiants d'un topic (format `user@domain`, UUID, `<lineId>`) pour optimiser les lookups dans le `Cache`. Résultat mis en cache.
- **`extractLineId(topic)`** — Extrait l'ID de ligne au format `<lineId>` d'un topic.
- **`toXcraftJSON(args, newStreamer)`** — Sérialise les arguments en format Xcraft JSON : détecte les streams à transférer, encode les types Immutable (`_xImmu`) et Shredder (`_xShred`), et sépare les chunks buffers en arguments distincts pour optimiser la sérialisation Axon.
- **`fromXcraftJSON(args, newStreamer)`** — Désérialise depuis le format Xcraft JSON en restaurant les types Immutable/Shredder et en reconstituant les chunks buffers.
- **`dataToXcraftJSON(d)`** — Convertit récursivement les données Immutable/Shredder en représentation JSON sérialisée avec marqueurs de type.
- **`dataFromXcraftJSON(d, root=false)`** — Restaure récursivement les données depuis leur représentation JSON Xcraft.
- **`tryStreamTo(msg, newStreamer)`** — Détecte et initialise le streaming pour un message contenant `xcraftUpload` ou `xcraftStream`.
- **`restoreChunkBuffer(args)`** — Reconstitue le buffer de chunk séparé dans les arguments de message.

### `lib/streamer.js`

Gestionnaire de flux de données pour le transfert de fichiers et streams volumineux à travers le réseau Xcraft. Chaque instance gère un seul transfert identifié par un `streamId`.

Le Streamer fonctionne selon deux directions :

- **Envoi** (constructeur appelé avec `stream`) : attend l'événement `stream.started.<streamId>` puis pipe le stream source par chunks.
- **Réception** (constructeur appelé sans `stream`) : souscrit aux événements `stream.chunked.<streamId>` et `stream.ended.<streamId>`.

Le mécanisme de streaming utilise des commandes RPC (`transport.{routingKey}.emit-chunk`, `emit-end`, `start-emit`) lorsque l'émetteur et le récepteur sont sur des nœuds différents. Pour les transferts locaux (`routingKey` identique), les événements Xcraft sont utilisés directement.

Un contournement pour un bug AMP (`s:`, `b:`, `j:` au début des buffers) est appliqué avant l'envoi de chaque chunk.

#### Méthodes publiques

- **`receive(remoteRoutingKey, stream, progress, next)`** — Lance la réception d'un stream vers `stream` (Writable). Appelle `progress(current, total)` à chaque chunk et `next(err)` à la fin ou en cas d'erreur. Timeout de 120s.

### `lib/backends/axon.js`

Backend de transport basé sur la bibliothèque [`xcraft-axon`](https://github.com/Xcraft-Inc/xcraft-axon), supportant TCP, TLS et Unix sockets pour la communication réseau inter-processus ou réseau.

#### Fonctionnalités avancées

- **TLS** : Support complet avec certificats serveur (`keyPath`, `certPath`) et client optionnel (`requestClientCert`). Les certificats statiques sont chargés depuis `resources/certs/` et les certificats dynamiques depuis `certsPath`. La surveillance des fichiers avec `chokidar` permet le rechargement à chaud via `refreshCerts()`.
- **Unix sockets** : Communication haute performance sur Linux via des sockets Unix (identifiés par inodes via `ss` et `/proc`). Désactivé sur Windows.
- **Gestion des inodes** : Pour les Unix sockets, l'inode côté serveur est résolu pour permettre le routage par "port" (qui est en fait l'inode).
- **Retry automatique** : En cas de conflit de port (`EADDRINUSE`, `EACCES`), le port est incrémenté et une nouvelle tentative est effectuée.
- **Queue de connexion** : Les messages `autoconnect` peuvent être mis en attente si `acceptIncoming` n'est pas encore activé.

#### Méthodes publiques

- **`connect(options, callback)`** — Établit une connexion client. Options : `host`, `port`, `timeout`, `caPath` (TLS), `keyPath`, `certPath`, `clientKeepAlive`, `unixSocketId`.
- **`start(options, callback)`** — Démarre le serveur. Options : `host`, `port`, `timeout`, `keyPath`, `certPath`, `serverKeepAlive`, `unixSocketId`.
- **`stop()`** — Ferme proprement le socket et le watcher TLS.
- **`send(topic, streamChannel, ...args)`** — Envoie un message (broadcast à tous les sockets connectés).
- **`sendTo(port, topic, streamChannel, ...args)`** — Envoie vers un socket spécifique identifié par son port (TCP) ou inode (Unix).
- **`subscribe(re, ids)`** — Souscrit à des patterns de messages (délègue au socket Axon).
- **`unsubscribe(re)`** — Se désinscrit d'un pattern.
- **`unsubscribeAll()`** — Supprime toutes les souscriptions.
- **`destroySockets(ports=[])`** — Détruit les sockets (tous si `ports` vide, sinon ceux correspondant aux ports listés).
- **`refreshCerts()`** — Recharge dynamiquement les certificats TLS (certificats statiques + dynamiques depuis `certsPath`).
- **`acceptIncoming()`** — Traite les connexions autoconnect mises en attente.
- **`status()`** — Retourne `{host, port, active, subscriptions}`.

### `lib/backends/ee.js`

Backend de transport basé sur `EventEmitter` Node.js pour les communications locales haute performance au sein du même processus. Les instances partagent un EventEmitter commun (`ee` global) identifié par `host:port`, ce qui permet une communication directe sans sérialisation réseau.

Chaque instance `EE` possède un identifiant UUID unique (`_id`) pour gérer le compteur de références et les événements `close` par instance.

#### Caractéristiques

- Communication synchrone ultra-rapide (même processus).
- Pas de sérialisation réseau — les objets sont passés par référence.
- Mise en cache des souscriptions via la classe `Cache` pour le filtrage efficace des topics.
- Support des modes `pubsub` et `pushpull` avec le même EventEmitter sous-jacent.
- Gestion des `onPending` : les handlers enregistrés avant la connexion sont appliqués lors de `connect`/`start`.

#### Méthodes publiques

- **`connect(options, callback)`** — Connecte à l'EventEmitter partagé identifié par `host:port`.
- **`start(options, callback)`** — Démarre le backend EventEmitter (idempotent si déjà démarré).
- **`stop()`** — Émet l'événement `close` et supprime tous les handlers.
- **`send(topic, streamChannel, ...args)`** — Émet un message local (appel synchrone).
- **`sendTo(port, topic, streamChannel, msg, ...args)`** — Identique à `send` (le `port` est ignoré pour EE).
- **`subscribe(re, ids)`** — Souscrit à un pattern de messages et l'ajoute au `Cache`.
- **`unsubscribe(re)`** — Se désinscrit d'un pattern.
- **`unsubscribeAll()`** — Supprime toutes les souscriptions.
- **`fixId(oId, nId)`** — Renomme la clé de l'EventEmitter partagé (utilisé lors des changements d'adresse).
- **`status()`** — Retourne `{active, subscriptions}`.

## Licence

Ce module est distribué sous [licence MIT](./LICENSE).

[xcraft-core-bus]: https://github.com/Xcraft-Inc/xcraft-core-bus
[xcraft-core-busclient]: https://github.com/Xcraft-Inc/xcraft-core-busclient
[xcraft-core-etc]: https://github.com/Xcraft-Inc/xcraft-core-etc
[xcraft-core-host]: https://github.com/Xcraft-Inc/xcraft-core-host
[xcraft-core-horde]: https://github.com/Xcraft-Inc/xcraft-core-horde
[xcraft-core-probe]: https://github.com/Xcraft-Inc/xcraft-core-probe
[xcraft-core-utils]: https://github.com/Xcraft-Inc/xcraft-core-utils
[xcraft-core-shredder]: https://github.com/Xcraft-Inc/xcraft-core-shredder

---

_Ce contenu a été généré par IA_
