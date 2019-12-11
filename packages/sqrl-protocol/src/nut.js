'use strict';

const crypto = require('crypto');
const base64url = require('universal-base64url');

const createNut = (id, secrets) => {
  try {
    const message = new ArrayBuffer(4);
    const dv = new DataView(message, 0, 4);
    dv.setUint32(0, id, false);
    const cipher = crypto.createCipheriv('bf-cbc', secrets.key, secrets.iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(message)),
      cipher.final()
    ]);
    return base64url.encode(encrypted);
  } catch (ex) {
    return null;
  }
};

const decodeNut = (nutParam, secrets) => {
  try {
    const message = Buffer.from(nutParam, 'base64');
    const decipher = crypto.createDecipheriv('bf-cbc', secrets.key, secrets.iv);
    return Buffer.concat([decipher.update(message), decipher.final()]);
  } catch (ex) {
    return null;
  }
};

module.exports = { createNut, decodeNut };
