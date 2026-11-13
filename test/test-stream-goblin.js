'use strict';

const {Readable} = require('node:stream');
const Goblin = require('xcraft-core-goblin');

const goblinName = 'test-stream-goblin';
const sources = new Map();

class TestReadable extends Readable {
  constructor(streamKey) {
    super();
    this.chunks = 0;
    this.destroyReason = null;
    this.streamKey = streamKey;
  }

  _read() {
    setImmediate(() => {
      if (!this.destroyed) {
        ++this.chunks;
        this.push(Buffer.alloc(8192, this.chunks % 255));
      }
    });
  }

  _destroy(err, callback) {
    this.destroyReason = err;
    callback();
  }
}

const logicState = {};
const logicHandlers = {
  create: (state, action) => state.set('id', action.get('id')),
};

Goblin.registerQuest(goblinName, 'create', function (quest) {
  quest.do();
  return quest.goblin.id;
});

Goblin.registerQuest(goblinName, 'open-stream', function (quest, streamKey) {
  const source = new TestReadable(streamKey);
  sources.set(streamKey, source);

  return {
    routingKey: require('xcraft-core-host').getRoutingKey(),
    xcraftStream: source,
  };
});

Goblin.registerQuest(goblinName, 'delete', function () {});

exports.getSources = () => sources;
exports.resetSources = () => sources.clear();
exports.xcraftCommands = function () {
  return Goblin.configure(goblinName, logicState, logicHandlers);
};
