'use strict';

const querystring = require('querystring');

// TODO: handle just strings
const decodeSQRLPack = what =>
  what
    .split('\r\n')
    .reduce((memo, item) => Object.assign(memo, querystring.decode(item)), {});

// TODO: handle just string
const encodeSQRLPack = what =>
  Object.keys(what).reduce(
    (memo, key) => memo + `${key}=${what[key]}` + '\r\n',
    ''
  );

module.exports = { decodeSQRLPack, encodeSQRLPack };
