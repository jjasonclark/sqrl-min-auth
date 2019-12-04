'use strict';

const logger = require('pino')({ level: 'info' });
const { db } = require('../lib/db/db');

const handler = async (event, context) => {
  try {
    logger.info({ event, context }, 'Starting handler');
    await db.none(
      "DELETE FROM nuts WHERE initial IS NOT NULL AND created <= NOW() - INTERVAL '1 DAY'"
    );
    await db.none(
      "DELETE FROM nuts WHERE initial IS NULL AND created <= NOW() - INTERVAL '1 DAY' AND id NOT IN (SELECT initial AS id FROM nuts WHERE created >= NOW() - INTERVAL '1 DAY')"
    );
    return { success: true };
  } catch (error) {
    logger.error(error);
    return { success: false };
  }
};

module.exports = { handler };
