#!/usr/bin/env node
'use strict';

const { runStageAutoTest } = require('../lib/stage-autotest/runner');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

class MockBackend {
  constructor(scenario) {
    this.name = 'mock';
    this.scenario = scenario;
    this.readCount = 0;
  }

  async launchRom() {
    return { sessionId: 'mock-1' };
  }

  async isRunning() {
    return true;
  }

  async shutdown() {}

  async pressButtons() {}

  async readRamSnapshot() {
    this.readCount++;
    if (this.scenario === 'wrong_level') {
      return {
        gameMode: 0x14,
        translevel_13bf: 0x99,
        inLevel: true,
        onOverworld: false,
        isTitle: false,
        marioY: 0x100,
        marioX: 0x80,
        water: false,
        slippery: 0,
        inNormalLevel: 1,
        vertical: 0,
        screens: 2,
        gameOver: false,
        runGame: 1,
        frameCounter: this.readCount,
      };
    }
    return {
      gameMode: this.readCount < 3 ? 0x00 : 0x14,
      translevel_13bf: 0x06,
      inLevel: this.readCount >= 3,
      onOverworld: this.readCount === 2,
      isTitle: this.readCount < 2,
      marioY: 0x100,
      marioX: 0x80,
      water: false,
      slippery: 0,
      inNormalLevel: 1,
      vertical: 0,
      screens: 2,
      gameOver: false,
      runGame: this.readCount,
      frameCounter: this.readCount,
    };
  }

  async writeRamByte() {}
}

function makeDeps(scenario) {
  return {
    userDataDir: '/tmp/sat-runner-test',
    clientDb: { prepare: () => ({ all: () => [] }) },
    dbManager: {
      getConnection: () => ({
        prepare: () => ({
          all: () => [{ epuuid: 'ep1', patch_code: '2lvno' }],
          get: () => null,
        }),
      }),
    },
    gameStager: {
      buildPlusPatchedGame: async () => ({
        success: true,
        outputPath: '/tmp/fake.sfc',
        filename: 'fake.sfc',
        patchIdentity: null,
      }),
    },
    createBackend: () => new MockBackend(scenario),
    onProgress: () => {},
  };
}

async function testBootAndVerifyPass() {
  const result = await runStageAutoTest({
    gameId: '1',
    gameVersion: 1,
    stage: { levelnumber: '106', translevel_13bf: '06', levelname: 'Test', requisites: null },
    configOverrides: {
      backend: 'retroarch',
      timeoutsSec: { boot: 1, navigate: 1 },
      inputPlan: { navigateWindowMs: 200, retryPressWindowMs: 200, buttonIntervalMs: 50 },
    },
  }, makeDeps('pass'));
  assert(result.success === true, 'expected pass');
}

async function testWrongLevelFails() {
  const result = await runStageAutoTest({
    gameId: '1',
    gameVersion: 1,
    stage: { levelnumber: '106', translevel_13bf: '06', levelname: 'Test' },
    configOverrides: {
      timeoutsSec: { boot: 1, navigate: 1 },
      inputPlan: { navigateWindowMs: 200, retryPressWindowMs: 200, buttonIntervalMs: 50 },
    },
  }, makeDeps('wrong_level'));
  assert(result.success === false, 'wrong level should fail');
}

async function main() {
  await testBootAndVerifyPass();
  await testWrongLevelFails();
  console.log('✅ test_stage_autotest_runner passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
