'use strict';

/**
 * nooverworld MTDispatch compatibility — per-ROM asm snippet for no-overworld-style
 * extrapatches (SNES game-mode site $009322). Not related to rhplay "dispatch chain".
 */

const fs = require('fs');

/** PC/file offset of SNES address $009322 (LoROM, no copier header). */
const ROM_MTDISPATCH_SITE_OFFSET = 4898;

/** 65816 JML opcode at relocated hack dispatch site. */
const JML_OPCODE = 0x5c;

const MTDISPATCH_INPUTS = new Set(['mtdispatch_code', 'mtdispatch_check']);

/**
 * Vanilla MTDispatch fallback when ROM still has stock bytes at $009322.
 * Re-creates JSL $0086DF indexed dispatch via fake return $009328.
 */
const VANILLA_MTDISPATCH_CODE = [
  '\tSEP #$30',
  '\tLDA #$00 : PHA',
  '\tLDA #$93 : PHA',
  '\tLDA #$28 : PHA',
  '\tLDA.w $0100',
  '\tJML $0086DF',
].join('\n');

/**
 * @param {Buffer} romBuffer
 * @returns {{ code: string, isRelocated: boolean }}
 */
function buildMTDispatchFromRom(romBuffer) {
  const headerSkip = romBuffer.length % 32768 === 512 ? 512 : 0;
  const site = headerSkip + ROM_MTDISPATCH_SITE_OFFSET;

  if (romBuffer[site] === JML_OPCODE) {
    const addr =
      (romBuffer[site + 1] ?? 0) |
      ((romBuffer[site + 2] ?? 0) << 8) |
      ((romBuffer[site + 3] ?? 0) << 16);
    return {
      code: `\tJML $${addr.toString(16).toUpperCase().padStart(6, '0')}`,
      isRelocated: true,
    };
  }

  return {
    code: VANILLA_MTDISPATCH_CODE,
    isRelocated: false,
  };
}

/**
 * @param {string} romPath
 * @returns {{ mtdispatch_code: string, mtdispatch_check: string }}
 */
function computeMTDispatchParamsFromRomPath(romPath) {
  const romBuffer = fs.readFileSync(romPath);
  const { code, isRelocated } = buildMTDispatchFromRom(romBuffer);
  return {
    mtdispatch_code: code,
    mtdispatch_check: isRelocated ? '1' : '0',
  };
}

/**
 * @param {object} mappings
 * @returns {boolean}
 */
function mappingsNeedMTDispatchParams(mappings) {
  if (!mappings || typeof mappings !== 'object') {
    return false;
  }

  for (const [key, mapping] of Object.entries(mappings)) {
    if (MTDISPATCH_INPUTS.has(key)) {
      return true;
    }
    const inputVar = mapping && typeof mapping === 'object' ? mapping.input : null;
    if (inputVar && MTDISPATCH_INPUTS.has(inputVar)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {Array<{ parameter_mappings?: string | null }>} patchObjects
 * @returns {boolean}
 */
function patchObjectsNeedMTDispatchParams(patchObjects) {
  for (const patch of patchObjects) {
    if (!patch.parameter_mappings) {
      continue;
    }
    try {
      const mappings = JSON.parse(patch.parameter_mappings);
      if (mappingsNeedMTDispatchParams(mappings)) {
        return true;
      }
    } catch {
      // ignore invalid JSON; apply step will surface errors
    }
  }
  return false;
}

module.exports = {
  ROM_MTDISPATCH_SITE_OFFSET,
  JML_OPCODE,
  VANILLA_MTDISPATCH_CODE,
  MTDISPATCH_INPUTS,
  buildMTDispatchFromRom,
  computeMTDispatchParamsFromRomPath,
  mappingsNeedMTDispatchParams,
  patchObjectsNeedMTDispatchParams,
};
