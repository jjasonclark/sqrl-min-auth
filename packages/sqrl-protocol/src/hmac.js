'use strict';

const { createHmac } = require('crypto');

const signHmac = (message, secret) => {
  const crypt = createHmac('sha256', secret);
  crypt.update(message);
  return crypt.digest('base64');
};

module.exports = { signHmac };
