'use strict';

const {expect} = require('chai');
const {extractIds} = require('../lib/helpers.js');
const Cache = require('../lib/cache.js');

describe('cache', function () {
  it('#extractIds for a simple line', function () {
    const ids = extractIds('albert@levert::my@entity.<with-a-line>');

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('<with-a-line>');
    expect(ids[2]).to.be.equal('albert@levert');
    expect(ids[3]).to.be.equal('my@entity');
  });

  it('#extractIds for line with id', function () {
    const ids = extractIds('albert@levert::my@entity.<its@an@id>');

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('albert@levert');
    expect(ids[2]).to.be.equal('my@entity');
    expect(ids[3]).to.be.equal('its@an@id');
  });

  it('#extractIds for command', function () {
    const ids = extractIds(
      'albert@levert::action.abc-abc-abc-abc-abc.finished'
    );

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('albert@levert');
    expect(ids[2]).to.be.equal('.abc-abc-abc-abc-abc.');
  });

  it('#matches global', function () {
    const cache = new Cache();
    let r;

    r = /a/;
    cache.set(extractIds('a')[0], r.toString(), r);
    r = /b/;
    cache.set(extractIds('b')[0], r.toString(), r);
    r = /c/;
    cache.set(extractIds('c')[0], r.toString(), r);

    expect(cache.matches('a')).to.be.true;
    expect(cache.matches('b')).to.be.true;
    expect(cache.matches('c')).to.be.true;
    expect(cache._cache.size).to.be.eql(1);
  });

  it('#matches id', function () {
    const cache = new Cache();
    let r;
    let id;
    let ids;

    r = /.*::a@a/;
    ids = extractIds('z@z::a@a');
    id = ids[ids.length - 1];
    cache.set(id, r.toString(), r);
    r = /.*::b.*/;
    ids = extractIds('z@z::b');
    id = ids[ids.length - 1];
    cache.set(id, r.toString(), r);
    r = /.*::.*/;
    ids = extractIds('a::a');
    id = ids[ids.length - 1];
    cache.set(id, r.toString(), r);

    expect(cache.matches('test::a@a')).to.be.true;
    expect(cache.matches('test:a@z')).to.be.false;
    expect(cache.matches('test::bb')).to.be.true;
    expect(cache.matches('test:bb')).to.be.false;
    expect(cache.matches('test')).to.be.false;
    expect(cache._cache.size).to.be.eql(3);
  });
});
