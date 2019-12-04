'use strict';

const { db } = require('./db');
const get = require('dlv');

const reorder = (objects, names, prop = 'idk') => {
  const output = new Array(names.length);
  let i = 0;
  const lookup = names.reduce((memo, name) => ({ ...memo, [name]: i++ }), {});
  for (const obj of objects) {
    const spot = get(lookup, get(obj, prop), -1);
    if (spot >= 0) {
      output[spot] = obj;
    }
  }
  return output;
};

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

const formatDb = result => ({
  ...result,
  idk: cleanString(result.idk),
  suk: cleanString(result.suk),
  vuk: cleanString(result.vuk)
});

// Crud for sqrl table
const sqrlCrud = {
  create(it) {
    return db.oneOrNone(
      'INSERT INTO sqrl (idk,user_id,suk,vuk,created) VALUES (${idk},${user_id},${suk},${vuk},${created}) RETURNING idk,user_id,suk,vuk,created,disabled,superseded',
      it
    );
  },

  async retrieve(idks) {
    const results = await db.manyOrNone(
      'SELECT idk,user_id,suk,vuk,created,disabled,superseded FROM sqrl WHERE idk IN ($1:list)',
      [idks]
    );
    if (!results) {
      return null;
    }

    return reorder(results.map(formatDb), idks);
  },

  update(it) {
    return db.none(
      'UPDATE sqrl set disabled=${disabled},superseded=${superseded} WHERE idk = ${idk}',
      it
    );
  },

  delete(userId) {
    return db.none('DELETE FROM sqrl WHERE user_id = $1', [userId]);
  }
};

module.exports = sqrlCrud;
