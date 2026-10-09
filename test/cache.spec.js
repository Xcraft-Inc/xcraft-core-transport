'use strict';

const {expect} = require('chai');
const {extractIds} = require('../lib/helpers.js');
const Cache = require('../lib/cache.js');

describe('xcraft.transport.cache', function () {
  it('extractIds for a simple line', function () {
    const ids = extractIds('albert@levert::my@entity.<with-a-line>');

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('<with-a-line>');
    expect(ids[2]).to.be.equal('albert@levert');
    expect(ids[3]).to.be.equal('my@entity');
  });

  it('extractIds for line with id', function () {
    const ids = extractIds('albert@levert::my@entity.<its@an@id>');

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('albert@levert');
    expect(ids[2]).to.be.equal('my@entity');
    expect(ids[3]).to.be.equal('its@an@id');
  });

  it('extractIds for command', function () {
    const ids = extractIds(
      'albert@levert::action.abc-abc-abc-abc-abc.finished'
    );

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('albert@levert');
    expect(ids[2]).to.be.equal('.abc-abc-abc-abc-abc.');
  });

  it('matches global', function () {
    const cache = new Cache();
    let r;

    r = /a/;
    cache.set(extractIds('a')[0], r.toString(), r);
    r = /b/;
    cache.set(extractIds('b')[0], r.toString(), r);
    r = /c/;
    cache.set(extractIds('c')[0], r.toString(), r);

    expect(cache.matches('a')).is.equals(true);
    expect(cache.matches('b')).is.equals(true);
    expect(cache.matches('c')).is.equals(true);
    expect(cache._cache.size).to.be.eql(1);
  });

  it('matches id', function () {
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

    expect(cache.matches('test::a@a')).is.equals(true);
    expect(cache.matches('test:a@z')).is.equals(false);
    expect(cache.matches('test::bb')).is.equals(true);
    expect(cache.matches('test:bb')).is.equals(false);
    expect(cache.matches('test')).is.equals(false);
    expect(cache._cache.size).to.be.eql(3);
  });

  it('extractIds for ', function () {
    const ids = extractIds('albert@levert::action.bragon@*-done');

    expect(ids[0]).to.be.equal('_');
    expect(ids[1]).to.be.equal('albert@levert');
    expect(ids.length).to.be.equal(2);

    const regex = /.*::action.bragon@.*-done/;
    const cache = new Cache();
    cache.set('_', regex.toString(), regex);

    expect(
      cache.matches('maurice@gertrude::action.bragon@pelisse-done')
    ).is.equals(true);
  });

  it('matches on empty cache', function () {
    const cache = new Cache();
    expect(cache.matches('a@b::x')).to.be.equal(false);
  });

  it('map on empty cache', function () {
    const cache = new Cache();
    expect(cache.map('a@b::x', () => 1)).to.be.eql([]);
  });

  it('map returns values in traversal order (specific before global)', function () {
    const cache = new Cache();
    const rGlobal = /::x/;
    const rSpecific = /a@b::x/;
    cache.set('_', rGlobal.toString(), rGlobal);
    cache.set('a@b', rSpecific.toString(), rSpecific);

    const res = cache.map('a@b::x', (id) => id);
    expect(res).to.be.eql(['a@b', '_']);
  });

  it('map passes id and key to the predicate', function () {
    const cache = new Cache();
    const r = /a@b::x/;
    cache.set('a@b', r.toString(), r);

    const res = cache.map('a@b::x', (id, key) => `${id}|${key}`);
    expect(res).to.be.eql([`a@b|${r.toString()}`]);
  });

  it('del on unknown id does not throw', function () {
    const cache = new Cache();
    expect(() => cache.del('unknown', 'key')).to.not.throw();
  });

  it('del removes the id when its last regex is removed', function () {
    const cache = new Cache();
    const r = /a/;
    cache.set('_', r.toString(), r);
    cache.del('_', r.toString());
    expect(cache._cache.size).to.be.equal(0);
    expect(cache.matches('a')).to.be.equal(false);
  });

  it('global flag does not make results stateful', function () {
    const cache = new Cache();
    const r = /a/g;
    cache.set('_', r.toString(), r);
    expect(cache.matches('a')).to.be.equal(true);
    expect(cache.matches('a')).to.be.equal(true);
    expect(cache.map('a', () => 1)).to.be.eql([1]);
    expect(cache.map('a', () => 1)).to.be.eql([1]);
  });
});
