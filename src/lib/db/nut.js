'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

const mapFromDb = result => {
  if (!result) {
    return null;
  }
  return {
    nut: result.nut.toString().trim(),
    ip: result.ip.toString().trim(),
    hmac: result.hmac ? result.hmac.toString().trim() : null,
    created: Date.parse(result.created),
    used: result.used ? Date.parse(result.used) : null,
    identified: result.identified,
    issued: result.issued ? Date.parse(result.issued) : null,
    inital: result.inital,
    user_id: result.user_id
  };
};

// Crud for nuts table
const nutCrud = {
  async create({ nut, ip, initial = null, userId = null, hmac = null }) {
    try {
      logger.debug({ nut, initial, ip, userId, hmac }, 'Create nut called');
      // TODO: verify write
      const result = await db.oneOrNone(
        'INSERT INTO nuts (nut,initial,ip,user_id,hmac) VALUES ($1,$2,$3,$4,$5) RETURNING nut,initial,ip,hmac,created,used,identified,issued,user_id',
        [nut, initial, ip, userId, hmac]
      );
      logger.debug({ nut }, 'Created nut');
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return '';
  },

  async findIssuedCode(code, requestIp) {
    try {
      logger.debug({ code, requestIp }, 'Finding issued code');
      const result = await db.oneOrNone(
        'SELECT nut,initial,ip,hmac,created,used,identified,issued,user_id FROM nuts WHERE issued IS NOT NULL AND nut = $1 AND ip = $2',
        [code, requestIp]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  async useNut(nut) {
    try {
      logger.debug({ nut }, 'Finding unused nut');
      const result = await db.oneOrNone(
        'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = $1 RETURNING nut,initial,ip,hmac,created,used,identified,issued,user_id',
        [nut]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  // Called to indicate the code has been issued to a user
  async useCode(code, requestIp) {
    try {
      logger.debug({ code, requestIp }, 'Finding unused code');
      const result = await db.oneOrNone(
        'UPDATE nuts SET issued=NOW() WHERE issued IS NULL AND identified IS NOT NULL AND nut = $1 AND ip = $2 RETURNING nut,initial,ip,hmac,created,used,identified,issued,user_id',
        [code, requestIp]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  async claim(nut, userId) {
    logger.debug({ nut, userId }, 'nutCrud.claim');
    try {
      const result = await db.oneOrNone(
        'UPDATE nuts SET user_id=$1 WHERE nut = $2 RETURNING nut,initial,ip,hmac,created,used,identified,issued,user_id',
        [userId, nut]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  async allowLogin(nutId, userId, identified = null) {
    logger.debug({ nut, userId, identified }, 'nutCrud.allowLogin');
    try {
      const result = await db.oneOrNone(
        'UPDATE nuts SET identified=$1,user_id=$2 WHERE id = $3 RETURNING nut,initial,ip,hmac,created,used,identified,issued,user_id',
        [identified || new Date().toISOString(), userId, nutId]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  }
};

module.exports = nutCrud;
