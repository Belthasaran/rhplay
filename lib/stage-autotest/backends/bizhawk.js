'use strict';

const { BaseStageAutoTestBackend } = require('./base');

class BizHawkBackend extends BaseStageAutoTestBackend {
  constructor() {
    super('bizhawk');
  }

  async launchRom() {
    throw new Error('BizHawk backend is not implemented yet. Set backend to "retroarch" in tester_config.json.');
  }
}

module.exports = { BizHawkBackend };
