'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

// Crud for nuts table
const nutCrud = {
  async create({ nut, ip, code, userId = null, hmac = null }) {
    logger.debug({ nut, code, ip, userId, hmac }, 'Create nut called');
    try {
      // TODO: verify write
      await db.none(
        'INSERT INTO nuts (nut,code,ip,user_id,hmac) VALUES ($1,$2,$3,$4,$5)',
        [nut, code, ip, userId, hmac]
      );
      logger.debug({ nut }, 'Created nut');
      return nut;
    } catch (ex) {
      logger.error(ex);
      return '';
    }
  },

  async useNut(nut) {
    try {
      logger.debug({ nut }, 'Finding unused nut');
      const result = await db.oneOrNone(
        'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = $1 RETURNING nut,code,ip,hmac,created,used,identified,issued,user_id',
        [nut]
      );
      if (result) {
        const formatted = {
          nut: result.nut.toString().trim(),
          code: result.code.toString().trim(),
          ip: result.ip.toString().trim(),
          hmac: result.hmac ? result.hmac.toString().trim() : null,
          created: Date.parse(result.created),
          used: result.used,
          identified: result.identified,
          issued: result.issued,
          user_id: result.user_id
        };
        return formatted;
      }
    } catch (ex) {
      logger.error(ex);
    }
    return null;
  },

  async useCode(code, requestIp) {
    logger.debug({ code, requestIp }, 'Finding unused code');
    try {
      return await db.oneOrNone(
        'UPDATE nuts SET issued=NOW() WHERE issued IS NULL AND identified IS NOT NULL AND nut = $1 AND ip = $2 RETURNING user_id',
        [code, requestIp]
      );
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
      return false;
    }
  }
};

module.exports = nutCrud;
