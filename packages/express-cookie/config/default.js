'use strict';

module.exports = {
  logger: { level: 'info' },
  express: { port: 3000, host: '0.0.0.0' },
  stopGrace: 5000,
  db: { connectionString: '' },
  sqrlHmac: null
};
