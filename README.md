# 📘 xcraft-core-transport

## Aperçu

Le module `xcraft-core-transport` fournit les backends de transport pour les modules [`xcraft-core-bus`][xcraft-core-bus] et [`xcraft-core-busclient`][xcraft-core-busclient]. Il implémente une couche d'abstraction pour la communication inter-processus et réseau dans l'écosystème Xcraft. Il supporte plusieurs protocoles (EventEmitter local, Axon sur TCP/TLS/sockets Unix) et offre des fonctionnalités avancées : streaming de données, routage par table ARP et par « lignes », gestion des certificats TLS avec rechargement à chaud, et exposition de métriques.

## Sommaire

- [Structure du module](#structure-du-module)
- [Fonctionnement global](#fonctionnement-global)
- [Exemples d'utilisation](#exemples-dutilisation)
- [Interactions avec d'autres modules](#interactions-avec-dautres-modules)
- [Configuration avancée](#configuration-avancée)
- [Détails des sources](#détails-des-sources)
- [Licence](#licence)

## Structure du module

Le module s'organise autour des composants suivants :

- **Router** (`lib/router.js`) : gestionnaire central de routage et d'orchestration des communications. Il maintient la table ARP, les lignes de connexion et les files d'attente de messages.
- **Backends** (`lib/backends/`) : implémentations des protocoles de transport. `axon.js` couvre TCP, TLS et sockets Unix ; `ee.js` couvre la communication locale par `EventEmitter`.
- **Cache** (`lib/cache.js`) : cache d'expressions régulières indexé par identifiants extraits des topics, afin de limiter le nombre de regex testées.
- **Streamer** (`lib/streamer.js`) : gestionnaire de flux pour le transfert de fichiers et de streams volumineux, avec gestion du timeout et de la contre-pression (pause/reprise).
- **Helpers** (`lib/helpers.js`) : sérialisation et désérialisation des messages Xcraft (types Immutable et Shredder), extraction d'identifiants de topics, préparation des streams.
- **`transport.js`** : exposition des commandes Xcraft d'administration, de streaming et de monitoring (dont les métriques).
- **`config.js`** : définition des options de configuration exploitées par [`xcraft-core-etc`][xcraft-core-etc].

## Fonctionnement global

### Architecture de routage

Le système utilise une table ARP pour maintenir les routes vers les différents « orcs » (clients connectés au bus). Chaque orc est identifié par un nom unique (`orcName`, généralement de la forme `nom@token`) et est joignable via le backend `axon` ou `ee`. La table ARP stocke, pour chaque orc : l'identifiant du routeur, le token, le socket, le port (ou l'inode pour les sockets Unix), la liste des hordes, les indicateurs `noForwarding` / `nice` et le nom du nœud (`nodeName`).

```
arp = {
  ee:   { [orcName]: { id, token, socket, port, hordes, noForwarding, nodeName, nice } },
  axon: { [orcName]: { id, token, socket, port, hordes, noForwarding, nodeName, nice } }
}
```

Par défaut, la table contient l'entrée `greathall` pour le backend `ee`.

### Modes de communication

- **Push/Pull** : communication point-à-point pour les commandes (le client `push` envoie au serveur `pull`).
- **Pub/Sub** : diffusion ou routage ciblé pour les événements (le serveur `pub` publie vers les clients `sub`).
- **Streaming** : transfert de données volumineuses via le `Streamer`, au-dessus des mécanismes précédents.

Les deux sockets d'un même client (commande et événements) sont liées : si l'une est détruite, le routeur détruit la socket correspondante de l'autre bus. Ceci évite les fuites, car côté serveur une socket de commande morte n'est détectée que lorsqu'on y écrit.

### Gestion des lignes (Lines)

Les « lignes » représentent des abonnements logiques à une entité (`<lineId>` dans un topic). Elles sont réparties en trois catégories :

- **local** : lignes du `greathall`, gérées en mémoire avec un compteur de références (Immutable.js).
- **remotes** : lignes distantes par horde, synchronisées depuis le warehouse (y compris les lignes de l'instance elle-même).
- **pending** : lignes en attente d'une table à jour. Les messages concernant ces lignes sont mis en file d'attente jusqu'à réception de la mise à jour.

Un numéro de `generation` permet d'ignorer les mises à jour obsolètes. La demande de mise à jour est envoyée en « fire and forget » via `warehouse.request-line-update`.

### Flux de routage des messages (pub)

```
send(topic, msg)
  └─ _pub(topic, msg)
       ├─ Événement .finished / .error / .orcished, ou forwarding.appId ?
       │    └─ résoudre l'orc ou la horde dans la table ARP
       │       (réessai jusqu'à 3 fois, toutes les 5 s, si la horde est absente)
       ├─ lineId présent dans le topic ?
       │    ├─ ligne pending ? → mise en file d'attente
       │    └─ sinon résoudre via lines.local / lines.remotes (+ passerelle par défaut)
       ├─ entrées ARP trouvées → sendTo(port, backend) sur le routeur concerné
       └─ aucune entrée → broadcast sur tous les backends
```

### Sérialisation

Les messages Xcraft sont sérialisés avec des marqueurs de type : les payloads Immutable sont stockés sous `_xImmu` et les Shredder sous `_xShred`, la clé `.` désignant la valeur de `data` elle-même. Les buffers de chunk sont déplacés dans un argument séparé pour permettre à Axon de les transmettre sans les stringifier. À la réception, `restoreChunkBuffer` replace ce buffer dans le message.

### Streaming de données

Le `Streamer` fonctionne dans deux directions :

- **Envoi** : attend `stream.started.<streamId>`, puis pipe le stream source par chunks. Pour un upload ou un destinataire de même routing key, les chunks transitent par les commandes `transport.<routingKey>.emit-chunk` / `emit-end` ; sinon ils sont publiés comme événements `stream.chunked.<streamId>.orcished`.
- **Réception** : souscrit à `stream.chunked` et `stream.ended`, vérifie le compteur de chunks (détection de flux corrompu) et écrit dans le stream de destination.

Le timeout est configurable (`streamer.timeout`, 120 s par défaut). Il est appliqué à la réception et rafraîchi à chaque chunk. Côté émission, si la socket d'événements accumule trop de données en attente, le streamer est mis en pause jusqu'à l'événement `drain`.

## Exemples d'utilisation

### Routeur push/pull (commandes)

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

### Routeur pub/sub (événements)

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

### Connexion TLS

```javascript
const client = new Router('client-1', 'push', xLog);
client.connect(
  'axon',
  {
    host: 'remote-server.example.com',
    port: 3334,
    caPath: '/path/to/ca.pem', // active TLS (ou "base64:..." pour un contenu inline)
    keyPath: '/path/to/client.key', // optionnel : certificat client
    certPath: '/path/to/client.pem',
  },
  () => {
    console.log('Connecté via TLS');
  }
);
```

### Envoi d'un fichier via un message

```javascript
// Le routeur détecte xcraftUpload et crée automatiquement le Streamer.
// Il accepte un chemin, un stream, ou un tableau de fichiers (empaquetés en tar).
resp.command.send('my-service.upload', {
  xcraftUpload: ['/tmp/report.pdf', {file: '/tmp/data.csv', name: 'data.csv'}],
});
```

### Sérialisation d'un message contenant du Immutable

```javascript
const {helpers} = require('xcraft-core-transport');
const {OrderedMap} = require('immutable');

const msg = {_xcraftMessage: true, data: OrderedMap({a: 1})};
const [wire] = helpers.toXcraftJSON(msg); // data: null, _xImmu: {'.': '...'}
const [restored] = helpers.fromXcraftJSON(wire); // data: OrderedMap restauré
```

### Monitoring via les commandes du bus

```javascript
const busClient = require('xcraft-core-busclient').getGlobal();
const resp = busClient.newResponse('transport', 'token');

// Les commandes sont préfixées par l'appId (et le tribe éventuel)
resp.command.send('myapp.arp', {}); // table ARP dans les logs de debug
resp.command.send('myapp.status', {}); // statut des routeurs
resp.command.send('myapp.xcraftMetrics', {}); // métriques
```

## Interactions avec d'autres modules

- **[xcraft-core-bus]** : le Router en récupère le token d'authentification pour le routage ; il s'appuie sur les backends de ce module de transport.
- **[xcraft-core-busclient]** : utilisé par le `Streamer` et le `Router` pour envoyer des commandes et événements (streaming, `warehouse.request-line-update`).
- **[xcraft-core-etc]** : chargement de la configuration du module (backends activés, TLS, timeout du streamer).
- **[xcraft-core-host]** : fournit `appId`, `appArgs()`, `appMasterId`, `getRoutingKey()` et `resourcesPath` (certificats statiques).
- **[xcraft-core-horde]** : dépendance optionnelle ; ses slaves alimentent le champ `hordes` des entrées ARP.
- **[xcraft-core-probe]** : mesure des opérations de transport (push, pub, subscribe, on).
- **[xcraft-core-utils]** : conversion des topics en expressions régulières (`toXcraftRegExpStr`, `toAxonRegExpStr`).
- **[xcraft-core-shredder]** : sérialisation et désérialisation des payloads `Shredder`.
- **[xcraft-core-fs]** : listing des backends disponibles.
- **[xcraft-core-log]** : journalisation.
- **[xcraft-core-server]** : charge dynamiquement `transport.js` pour exposer ses commandes sur le bus (`config.xcraft.commands`).
- **[xcraft-axon]** : implémentation sous-jacente du backend `axon`.

## Configuration avancée

Les options sont définies dans `config.js` et exploitées via [`xcraft-core-etc`][xcraft-core-etc].

| Option              | Description                                                    | Type    | Valeur par défaut        |
| ------------------- | -------------------------------------------------------------- | ------- | ------------------------ |
| `backends`          | Backends activés (liste vide = tous ceux de `lib/backends`)    | Array   | `[]`                     |
| `axon.clientOnly`   | Connexions client uniquement (désactive l'écoute serveur Axon) | Boolean | `false`                  |
| `requestClientCert` | Exiger un certificat client TLS                                | Boolean | `false`                  |
| `certsPath`         | Emplacement des certificats clients                            | String  | `{xcraftRoot}/var/certs` |
| `keysPath`          | Emplacement des clés privées clients                           | String  | `{xcraftRoot}/var/keys`  |
| `streamer.timeout`  | Timeout par défaut du streamer, en millisecondes               | Number  | `120000`                 |

### Variables d'environnement

Ce module n'utilise pas de variables d'environnement directement. La configuration passe par [`xcraft-core-etc`][xcraft-core-etc] et [`xcraft-core-host`][xcraft-core-host].

## Détails des sources

### `transport.js`

Expose les commandes Xcraft d'administration, de monitoring et de streaming. Le namespace est construit dynamiquement à partir de `appId` et du `tribe` éventuel (ex. `myapp.arp`, `myapp-tribe1.status`). Toutes les commandes sont déclarées avec `parallel: true`.

#### Commandes publiques

- **`{ns}.arp`** — Affiche la table ARP (backend, orcName, id, token, port, hordes) dans les logs de debug.
- **`{ns}.arp.hordes`** — Affiche, par orc, les hordes connues sous forme de tableau visuel.
- **`{ns}.lines`** — Affiche les lignes actives avec leur compteur de références par orc.
- **`{ns}.status`** — Affiche le statut des routeurs (mode, backends actifs, souscriptions).
- **`{ns}.emit-chunk`** — Republie un chunk sous forme d'événement `stream.chunked.<streamId>` (utilisé par le `Streamer`).
- **`{ns}.emit-end`** — Republie la fin d'un stream (`stream.ended.<streamId>`).
- **`{ns}.start-emit`** — Signale le démarrage d'un stream (`stream.started.<streamId>`) avec la routing key du récepteur.
- **`xcraftMetrics`** — Extrait les métriques : taille de la table ARP, lignes (locales, distantes, pending), nombre de routeurs, souscriptions, sockets et octets lus/écrits.

### `lib/index.js`

Point d'entrée du module. Gère un registre global des routeurs, indexé par id puis par mode. La classe `WrappedRouter` étend `Router` : elle s'enregistre à la construction et se désenregistre lors de `stop()`.

Exports :

- `helpers` — utilitaires de sérialisation et d'extraction d'identifiants.
- `Cache` — cache d'expressions régulières.
- `Router` — la classe `WrappedRouter`.
- `getRouters()` — liste à plat de tous les routeurs actifs.

### `lib/router.js`

Cœur du routage. Il charge dynamiquement les backends de `lib/backends/` en filtrant selon `config.backends`, puis câble les événements selon le mode (`pull` : message, error, reject, disconnect ; `pub` : error, reject, disconnect, `stream need drain`).

Points notables :

- Les messages internes préfixés par `:` (ex. `:delete-route`) sont traités par le routeur.
- Une route est insérée dans la table ARP à partir du champ `arp` des messages entrants.
- En cas de client TLS rejeté, un événement spécial `xcraft::axon/reject` est renvoyé avec le code `XCRAFT_AXON_CLIENT_CERTIFICATE_REJECT`.
- Au-delà de 20 Mo en attente d'écriture sur une socket d'événements, le streamer est mis en pause ; à partir de 100 Mo, la socket est détruite.
- Le routeur met en cache un message dont la ligne est en attente et le rejoue après `updateLines`.
- Si le port a changé après le démarrage (Axon), l'identifiant est corrigé sur tous les backends via `fixId`.

#### Méthodes publiques d'instance

- **`start(options, callback)`** — Démarre tous les backends. Options : `host`, `port`, `unixSocketId`, `timeout`, `keyPath`, `certPath`, `serverKeepAlive`.
- **`stop()`** — Arrête les backends.
- **`connect(backend, options, callback)`** — Connecte le routeur à un backend en mode client ; lève une erreur si le backend n'est pas supporté.
- **`send(topic, ...args)`** — Envoie un message (`_push` en mode client connecté, `_pub` en mode serveur). Réservé aux modes `push` et `pub`.
- **`subscribe(topic, backend, orcName)`** — Souscrit à un topic (mode `sub` uniquement) et gère la connexion de ligne. Retourne `{ids, str, reg}`.
- **`unsubscribe(topic, backend, orcName)`** — Se désinscrit et libère la ligne associée.
- **`on(topic, handler, proxy=false)`** — Écoute un événement sur tous les backends.
- **`hook(topic, handler)`** — Enregistre un handler interne appelé après le traitement de routage.
- **`status()`** — Retourne `{backends, options, mode, connectedWith}`.
- **`acceptIncoming()`** — Autorise les connexions entrantes retenues (`autoconnect`).
- **`onInsertOrc(handler)`** / **`onDeleteOrc(handler)`** — Notifications d'insertion et de suppression d'un orc dans la table ARP.
- **`connectedWith()`** — Nom du backend utilisé pour la connexion cliente.
- **`destroySockets()`** — Détruit toutes les sockets de tous les backends.

Accesseurs : `id`, `mode`, `options`, `noForwarding`, `ports`, `isLocalOnly`, `isUnixSocket`, `lastPerf`.

#### Méthodes statiques

- **`deleteRoute(orcName, backend)`** — Supprime une route (et l'entrée `ee` si le backend est `axon`).
- **`updateLines(_lines, _token, generation, horde)`** — Met à jour les lignes distantes et rejoue les messages en attente.
- **`connectLine(lineId, orcName)`** / **`disconnectLine(lineId, orcName)`** — Gèrent les lignes locales (compteur) ou demandent une mise à jour distante.
- **`moveRoute(oldOrcName, newOrcName)`** — Renomme une route temporaire (autoconnect) en route définitive.
- **`getRoute(orcName, backend)`**, **`getRouters(orcName, backend)`**, **`getARP()`**, **`getLines()`**, **`getNice(orcName, backend)`**, **`extractLineId(topic)`**, **`setRoutersRegistry(registry)`**.

### `lib/cache.js`

Cache de regex optimisé : plutôt que de tester toutes les regex pour chaque topic, il extrait les identifiants du topic (`extractIds`) et ne teste que celles associées à ces identifiants, du plus spécifique au plus global (`_`). Le `lastIndex` est réinitialisé avant chaque test, ce qui rend les regex à drapeau `g` sans état.

#### Méthodes publiques

- **`matches(topic)`** — `true` si au moins une regex correspond.
- **`map(topic, predicate)`** — Retourne les valeurs `predicate(id, key)` pour chaque regex correspondante, dans l'ordre spécifique → global.
- **`set(id, key, value)`** — Ajoute une regex.
- **`del(id, key)`** — Supprime une regex ; l'identifiant est supprimé quand il n'a plus d'entrée.
- **`clear()`** — Vide le cache.

### `lib/helpers.js`

Utilitaires de sérialisation, de streams et d'extraction d'identifiants. Le cache interne des identifiants est limité à 4096 entrées (purge de 128 entrées à chaque dépassement). Les modules `fs`, `path`, `gigawatts` et `tar-stream` sont chargés dynamiquement de façon à ne pas être découverts par webpack.

#### Fonctions principales

- **`extractIds(topic)`** — Extrait et ordonne les identifiants d'un topic (`a@b`, UUID, `<lineId>`) ; `_` est toujours en première position.
- **`extractLineId(topic)`** — Extrait l'id de ligne entre `<` et `>`.
- **`toXcraftJSON(args, newStreamer)`** — Sérialise les messages (streams, Immutable, Shredder, chunks).
- **`fromXcraftJSON(args, newStreamer)`** — Opération inverse ; conserve le message brut dans `_xcraftRawMessage` à la racine.
- **`dataToXcraftJSON(d)`** / **`dataFromXcraftJSON(d, root=false)`** — Conversion récursive des données.
- **`tryStreamTo(msg, newStreamer)`** — Initialise le streaming pour `xcraftUpload` / `xcraftStream` (fichier, tableau de fichiers empaquetés en tar, ou stream).
- **`restoreChunkBuffer(args)`** — Réinjecte le buffer de chunk séparé.

### `lib/streamer.js`

Gère un transfert unique, identifié par `streamId`. Il applique une contre-mesure au bug AMP (buffers commençant par `s:`, `b:` ou `j:`) en remplaçant le premier octet et en transmettant la valeur d'origine dans `prefix`.

#### Méthodes publiques

- **`receive(remoteRoutingKey, stream, progress, next)`** — Reçoit un stream vers un `Writable`. Appelle `progress(current, total)` à chaque chunk et `next(err)` à la fin ou en erreur (timeout, compteur incohérent, erreur du stream). Gère la contre-pression via `drain`.
- **`pause()`** / **`resume()`** — Suspendent et reprennent l'émission. Si la pause dépasse le timeout, les écritures en attente échouent avec `streamer sender drain timeout`.
- **`paused`** — Accesseur d'état de pause.

### `lib/backends/axon.js`

Backend basé sur [`xcraft-axon`][xcraft-axon] (TCP, TLS, sockets Unix).

#### Fonctionnalités avancées

- **TLS** : activé côté serveur quand `keyPath` et `certPath` sont fournis, côté client avec `caPath`. Les certificats statiques sont lus dans `resources/certs/*.pem`, les dynamiques dans `certsPath`. Un watcher `chokidar` recharge les CA à chaud (`refreshCerts`). Le rejet des clients non autorisés est géré par Axon (`rejectUnauthorized: false`).
- **Sockets Unix** : actives si `unixSocketId` est fourni (hors Windows). L'inode, récupéré via `/proc` et la commande `ss` (Linux uniquement), remplace le port pour le routage.
- **Relance de port** : en cas d'`EADDRINUSE` / `EACCES`, le port est incrémenté et le bind est retenté.
- **File d'attente `autoconnect`** : mise en attente tant que `acceptIncoming()` n'a pas été appelé.
- **Mode `clientOnly`** : l'écoute est désactivée avec un avertissement.
- **Contre-pression** : l'événement `socket need drain` est relayé en `stream need drain` avec le streamer en cours.

#### Méthodes publiques

- **`connect(options, callback)`** — Connexion cliente. Options : `host`, `port`, `timeout`, `caPath`, `keyPath`, `certPath`, `clientKeepAlive`, `unixSocketId`.
- **`start(options, callback)`** — Démarre le serveur.
- **`stop()`** — Retire les listeners, ferme le watcher et la socket.
- **`send(topic, streamChannel, ...args)`** / **`sendTo(port, topic, streamChannel, ...args)`** — Envoi broadcast ou vers une socket précise (port TCP ou inode Unix). Les messages sont mis en file si aucune socket n'est connectée.
- **`subscribe(re, ids)`**, **`unsubscribe(re)`**, **`unsubscribeAll()`** — Gestion des souscriptions.
- **`destroySockets(ports=[])`** — Détruit toutes les sockets ou celles des ports donnés.
- **`refreshCerts()`** — Recharge les certificats TLS.
- **`acceptIncoming()`** — Traite les messages `autoconnect` retenus.
- **`status()`** — Retourne `{host, port, active, subscriptions}`.

### `lib/backends/ee.js`

Backend `EventEmitter` pour les communications locales dans un même processus. Les instances partagent un `EventEmitter` global identifié par `host:port` et par type (`pubsub` ou `pushpull`), avec un compteur de références. Les messages sont désérialisés (`fromXcraftJSON`) et les streams sont passés directement, sans sérialisation réseau. Le `Cache` filtre les messages selon les souscriptions.

#### Méthodes publiques

- **`connect(options, callback)`** / **`start(options, callback)`** — Rejoint ou crée l'émetteur partagé (`start` est idempotent).
- **`stop()`** — Émet `close`, supprime les souscriptions et les listeners.
- **`send(...)`** / **`sendTo(port, ...)`** — Émission locale (le port est ignoré).
- **`subscribe(re, ids)`**, **`unsubscribe(re)`**, **`unsubscribeAll()`** — Gestion des souscriptions via le `Cache`.
- **`fixId(oId, nId)`** — Renomme la clé de l'émetteur partagé.
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
[xcraft-core-fs]: https://github.com/Xcraft-Inc/xcraft-core-fs
[xcraft-core-log]: https://github.com/Xcraft-Inc/xcraft-core-log
[xcraft-core-server]: https://github.com/Xcraft-Inc/xcraft-core-server
[xcraft-axon]: https://github.com/Xcraft-Inc/xcraft-axon

---

_Ce contenu a été généré par IA_
