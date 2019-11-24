'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

const mapFromDb = result => {
  if (!result) {
    return null;
  }
  return {
    nut: result.nut.toString().trim(),
    code: result.code.toString().trim(),
    ip: result.ip.toString().trim(),
    hmac: result.hmac ? result.hmac.toString().trim() : null,
    created: Date.parse(result.created),
    used: result.used ? Date.parse(result.used) : null,
    identified: result.identified,
    issued: result.issued ? Date.parse(result.issued) : null,
    user_id: result.user_id
  };
};

// Crud for nuts table
const nutCrud = {
  async create({ nut, ip, code, userId = null, hmac = null }) {
    logger.debug({ nut, code, ip, userId, hmac }, 'Create nut called');
    try {
      // TODO: verify write
      const result = await db.oneOrNone(
        'INSERT INTO nuts (nut,code,ip,user_id,hmac) VALUES ($1,$2,$3,$4,$5) RETURNING nut,code,ip,hmac,created,used,identified,issued,user_id',
        [nut, code, ip, userId, hmac]
      );
      logger.debug({ nut }, 'Created nut');
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return '';
  },

  async useNut(nut) {
    try {
      logger.debug({ nut }, 'Finding unused nut');
      const result = await db.oneOrNone(
        'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = $1 RETURNING nut,code,ip,hmac,created,used,identified,issued,user_id',
        [nut]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  async useCode(code, requestIp) {
    logger.debug({ code, requestIp }, 'Finding unused code');
    try {
      const result = await db.oneOrNone(
        'UPDATE nuts SET issued=NOW() WHERE identified IS NOT NULL AND nut = $1 AND ip = $2 RETURNING nut,code,ip,hmac,created,used,identified,issued,user_id',
        [code, requestIp]
      );
      return mapFromDb(result);
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  async update(nut, userId, identified = null) {
    logger.debug({ nut, userId, identified }, 'NutCrud.update');
    try {
      await db.none('UPDATE nuts SET identified=$1,user_id=$2 WHERE nut = $3', [
        identified,
        userId,
        nut
      ]);
      return true;
    } catch (ex) {
      logger.error(ex);
    }
    return false;
  }
};

module.exports = nutCrud;
