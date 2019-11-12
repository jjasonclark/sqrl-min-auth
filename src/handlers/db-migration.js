'use strict';

const path = require('path');
const logger = require('pino')({ level: 'debug' });
const fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
const { db } = require('../lib/db/db');
const sqlPath = path.resolve(__dirname, '..', '..', 'sql/create.sql');

const applySqlFile = async sqlPath => {
  try {
    logger.info({ sqlPath }, 'reading file');
    const commands = (await readFile(sqlPath)).toString();
    logger.info({ commandLength: commands.length }, 'Read migration file');
    const result = await db.none(commands);
    logger.info({ result }, 'Apply success');
    return true;
  } catch (error) {
    logger.error(error);
  }
  return false;
};

const handler = async (event, context) => {
  logger.info({ event, context }, 'Starting handler');
  const success = await applySqlFile(sqlPath);
  return { success };
};

module.exports = { handler };
