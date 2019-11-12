'use strict';

const logger = require('pino')({ level: 'info' });
const { createNut } = require('../nut');
const { db } = require('./db');
const { signHmac } = require('../hmac');

// Crud for nuts table
const nutCrud = {
  async useCode(code, requestIp) {
    try {
      logger.info({ code, requestIp }, 'Finding unused code');
      const result = await db.oneOrNone(
        'UPDATE nuts SET issued=NOW() WHERE issued IS NULL AND identified IS NOT NULL AND nut = $1 AND ip = $2 RETURNING user_id',
        [code, requestIp]
      );
      logger.info({ code, result, requestIp }, 'DB result');
      return result;
    } catch (ex) {
      logger.error(ex);
      logger.info({ nut }, 'Failed to find code');
    }
    return null;
  },

  async createInitialNut(requestIP) {
    try {
      // TODO: verify created not isn't already in DB
      const nut = await createNut();
      logger.info({ nut, requestIP }, 'Inserting new initial nut');
      // TODO: verify write
      await db.none('INSERT INTO nuts (nut,code,ip) VALUES ($1,$2,$3)', [
        nut,
        nut,
        requestIP
      ]);
      return nut;
    } catch (ex) {
      logger.info({ requestIP }, 'Create initial nut failed');
      logger.error(ex);
      return '';
    }
  },

  async createFollowUpNut(requestIP, code) {
    try {
      // TODO: verify created not isn't already in DB
      const nut = await createNut();
      await db.none('INSERT INTO nuts (nut,code,ip) VALUES ($1,$2,$3)', [
        nut,
        code,
        requestIP
      ]);
      return nut;
    } catch (ex) {
      logger.error(ex);
      return '';
    }
  },

  async markNutUsed(nut) {
    try {
      await db.none(
        'UPDATE nuts SET used=NOW() WHERE used IS NULL AND nut = $1',
        [nut]
      );
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async markUser(nut, userId) {
    try {
      await db.none(
        'UPDATE nuts SET user_id=$1 WHERE user_id IS NULL AND nut = $2',
        [userId, nut]
      );
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async markIdentified(code, userId) {
    try {
      await db.none(
        'UPDATE nuts SET identified=NOW(),user_id=$1 WHERE identified IS NULL AND nut = $2',
        [userId, code]
      );
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async updateHmac(nut, body) {
    try {
      const hmacValue = signHmac(body);
      logger.debug({ nut, hmacValue }, 'Updating follow up nut');
      await db.none('UPDATE nuts SET hmac=$1 WHERE used IS NULL AND nut = $2', [
        hmacValue,
        nut
      ]);
      return true;
    } catch (ex) {
      logger.error(ex);
      return false;
    }
  },

  async findNut(nut) {
    try {
      const result = await db.oneOrNone(
        'SELECT nut,code,ip,hmac,used,identified,issued FROM nuts WHERE nut = $1',
        [nut]
      );
      if (result) {
        const formatted = {
          nut: result.nut.toString().trim(),
          code: result.code.toString().trim(),
          ip: result.ip.toString().trim(),
          hmac: result.hmac ? result.hmac.toString().trim() : null,
          used: result.used,
          identified: result.identified,
          issued: result.issued
        };
        return formatted;
      }
    } catch (ex) {
      logger.error(ex);
      logger.info({ nut }, 'Failed to find nut');
    }
    return null;
  }
};

module.exports = nutCrud;
