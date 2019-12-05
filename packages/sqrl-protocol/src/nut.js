'use strict';

const crypto = require('crypto');
const util = require('util');
const base64url = require('universal-base64url');
const randomFill = util.promisify(crypto.randomFill);

const lotsOfRandom = async () => {
  const randomBuffer = Buffer.alloc(17);
  await randomFill(randomBuffer);
  return randomBuffer;
};

const createNut = async () => {
  try {
    const counter = await lotsOfRandom();
    return base64url.encode(counter);
  } catch (ex) {
    return null;
  }
};

module.exports = { createNut };
