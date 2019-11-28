'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('./db');

const cleanString = value => {
  if (!value) {
    return null;
  }
  const formatted = value.toString().trim();
  if (!formatted || formatted === '') {
    return null;
  }
  return formatted;
};

// Crud for sqrl table
const sqrlCrud = {
  async create(it) {
    const sqrlData = await db.oneOrNone(
      'INSERT INTO sqrl (idk,user_id,suk,vuk,hardlock,sqrlonly) VALUES ($1,$2,$3,$4,$5,$6) RETURNING idk',
      [it.idk, it.user_id, it.suk, it.vuk, it.hardlock, it.sqrlonly]
    );
    if (sqrlData) {
      // Account setup successfully
      logger.info({ sqrlData }, 'Account created');
      return sqrlData;
    }
    // something went wrong
    logger.info({ it }, 'Could not create sqrl row');
    return null;
  },

  async retrieve(idks) {
    const results = await db.manyOrNone(
      'SELECT idk, user_id, suk, vuk, disabled, hardlock, sqrlonly, superseded FROM sqrl WHERE idk IN $1',
      [idks]
    );
    if (!results || results.length <= 0) {
      return null;
    }
    return results.map(result => ({
      ...result,
      idk: cleanString(result.idk),
      suk: cleanString(result.suk),
      vuk: cleanString(result.vuk)
    }));
  },

  async update({ idk, disabled, hardlock, sqrlonly, superseded = null }) {
    return await db.none(
      'UPDATE sqrl set disabled=$1,hardlock=$2,sqrlonly=$3,superseded=$4 WHERE idk = $5',
      [disabled, hardlock, sqrlonly, superseded, idk]
    );
  },

  async delete(userId) {
    return await db.none('DELETE FROM sqrl WHERE user_id = $1', [userId]);
  }
};

module.exports = sqrlCrud;
