'use strict';

const {expect} = require('chai');
const {OrderedMap} = require('immutable');
const Shredder = require('xcraft-core-shredder');
const helpers = require('../lib/helpers.js');

describe('XcraftJSON', function() {
  const v1 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {c: 1, d: {}},
  };
  const v2 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: OrderedMap({c: 1, d: {}}),
  };
  const v3 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: new Shredder(OrderedMap({c: 1, d: {}})),
  };

  const v4 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {c: 1, d: {}, data: {e: 1, f: {}}},
  };
  const v5 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {c: 1, d: {}, data: OrderedMap({e: 1, f: {}})},
  };
  const v6 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {c: 1, d: {}, data: new Shredder(OrderedMap({e: 1, f: {}}))},
  };

  const v7 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: [{c: 1, d: {}}, {e: 1, f: {}}],
  };
  const v8 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: [OrderedMap({c: 1, d: {}}), OrderedMap({e: 1, f: {}})],
  };
  const v9 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: [
      new Shredder(OrderedMap({c: 1, d: {}})),
      new Shredder(OrderedMap({e: 1, f: {}})),
    ],
  };

  const v10 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {g: 1, data: [{c: 1, d: {}}, {e: 1, f: {}}]},
  };
  const v11 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {g: 1, data: [OrderedMap({c: 1, d: {}}), OrderedMap({e: 1, f: {}})]},
  };
  const v12 = {
    _xcraftMessage: true,
    a: 1,
    b: {},
    data: {
      g: 1,
      data: [
        new Shredder(OrderedMap({c: 1, d: {}})),
        new Shredder(OrderedMap({e: 1, f: {}})),
      ],
    },
  };

  it('#object', function() {
    const s = helpers.toXcraftJSON(v1)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    expect(v).to.be.eql(v1);
  });

  it('#immutable', function() {
    const s = helpers.toXcraftJSON(v2)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v2);
  });

  it('#shredder', function() {
    const s = helpers.toXcraftJSON(v3)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v3);
  });

  it('#object-nested', function() {
    const s = helpers.toXcraftJSON(v4)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    expect(v).to.be.eql(v4);
  });

  it('#immutable-nested', function() {
    const s = helpers.toXcraftJSON(v5)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v5);
  });

  it('#shredder-nested', function() {
    const s = helpers.toXcraftJSON(v6)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v6);
  });

  it('#object-array', function() {
    const s = helpers.toXcraftJSON(v7)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    expect(v).to.be.eql(v7);
  });

  it('#immutable-array', function() {
    const s = helpers.toXcraftJSON(v8)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v8);
  });

  it('#shredder-array', function() {
    const s = helpers.toXcraftJSON(v9)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v9);
  });

  it('#object-array-nested', function() {
    const s = helpers.toXcraftJSON(v10)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    expect(v).to.be.eql(v10);
  });

  it('#immutable-array-nested', function() {
    const s = helpers.toXcraftJSON(v11)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v11);
  });

  it('#shredder-array-nested', function() {
    const s = helpers.toXcraftJSON(v12)[0];
    const v = helpers.fromXcraftJSON(s)[0];
    delete v._xcraftRawMessage;
    expect(v).to.be.eql(v12);
  });
});
