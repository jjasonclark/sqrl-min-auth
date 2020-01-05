'use strict';

const boolResult = async func => {
  try {
    await func();
    return true;
  } catch (ex) {
    return false;
  }
};

class IdentityProvider {
  constructor(opts) {
    this.logger = opts.logger;
    this.store = opts.store;
  }

  async find(idks) {
    const filtered = idks.filter(Boolean);
    this.logger.info({ idks, filtered }, 'Fetching sqrl data');
    const results = await this.store.retrieveSqrl(filtered);
    return results || [];
  }

  async create(userId, client) {
    if (!userId || !client) {
      return null;
    }
    const sqrlData = {
      idk: client.idk,
      suk: client.suk,
      vuk: client.vuk,
      user_id: userId,
      created: new Date().toISOString(),
      disabled: null,
      superseded: null
    };
    const result = await boolResult(() => this.store.createSqrl(sqrlData));
    return result ? sqrlData : null;
  }

  async enable(sqrlData) {
    this.logger.info({ sqrlData }, 'Enabling sqrl');
    sqrlData.disabled = null;
    // Set flags to current choices
    return await boolResult(() => this.store.updateSqrl(sqrlData));
  }

  async disable(sqrlData) {
    this.logger.info({ sqrlData }, 'Disabling sqrl');
    sqrlData.disabled = new Date().toISOString();
    return await boolResult(() => this.store.updateSqrl(sqrlData));
  }

  async superseded(sqrlData) {
    this.logger.info({ sqrlData }, 'Superseding sqrl');
    const updateTime = new Date().toISOString();
    sqrlData.disabled = sqrlData.disabled || updateTime;
    sqrlData.superseded = updateTime;
    // mark old idk as disabled and superseded
    return await boolResult(() => this.store.updateSqrl(sqrlData));
  }

  async remove(sqrlData) {
    this.logger.info({ sqrlData }, 'Deleting sqrl');
    // Delete login to user association
    return await boolResult(() => this.store.deleteSqrl(sqrlData));
  }
}

module.exports = IdentityProvider;
