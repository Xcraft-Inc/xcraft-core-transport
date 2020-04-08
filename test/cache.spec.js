'use strict';

const {expect} = require('chai');
const {extractIds} = require('../lib/helpers.js');
const Cache = require('../lib/cache.js');

describe('cache', function () {
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
    id = ids.length > 1 ? ids[1] : ids[0];
    cache.set(id, r.toString(), r);
    r = /.*::b.*/;
    ids = extractIds('z@z::b');
    id = ids.length > 1 ? ids[1] : ids[0];
    cache.set(id, r.toString(), r);
    r = /.*::.*/;
    ids = extractIds('a::a');
    id = ids.length > 1 ? ids[1] : ids[0];
    cache.set(id, r.toString(), r);

    expect(cache.matches('test::a@a')).to.be.true;
    expect(cache.matches('test:a@z')).to.be.false;
    expect(cache.matches('test::bb')).to.be.true;
    expect(cache.matches('test:bb')).to.be.false;
    expect(cache.matches('test')).to.be.false;
    expect(cache._cache.size).to.be.eql(3);
  });
});
