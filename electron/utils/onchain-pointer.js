/**
 * onchain-pointer.js
 *
 * Query Arbitrum One PointerRegistry contract for latest() pointer
 */

const { ethers } = require('ethers');

// Arbitrum One chain ID
const ARBITRUM_ONE_CHAIN_ID = 42161;

// Default RPC endpoints (public, with fallback)
const DEFAULT_RPC_ENDPOINTS = [
  'https://arb1.arbitrum.io/rpc',
  'https://arbitrum-one.publicnode.com',
  'https://rpc.ankr.com/arbitrum',
  'https://arbitrum.llamarpc.com'
];

// PointerRegistry ABI (minimal - just latest() function)
const POINTER_REGISTRY_ABI = [
  {
    inputs: [],
    name: 'latest',
    outputs: [
      { internalType: 'uint64', name: 'currentVersion', type: 'uint64' },
      { internalType: 'uint64', name: 'updatedAt', type: 'uint64' },
      { internalType: 'bytes32', name: 'payloadSha256', type: 'bytes32' },
      { internalType: 'uint64', name: 'payloadSize', type: 'uint64' },
      { internalType: 'string', name: 'cid', type: 'string' },
      { internalType: 'string[]', name: 'brefs', type: 'string[]' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
];

/**
 * Get RPC provider with fallback
 */
function getRpcProvider(customRpcUrl = null) {
  const rpcUrls = customRpcUrl ? [customRpcUrl, ...DEFAULT_RPC_ENDPOINTS] : DEFAULT_RPC_ENDPOINTS;
  
  // Try each RPC endpoint until one works
  for (const rpcUrl of rpcUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl, {
        chainId: ARBITRUM_ONE_CHAIN_ID,
        name: 'arbitrum-one'
      });
      return provider;
    } catch (err) {
      console.warn(`[onchain-pointer] Failed to create provider for ${rpcUrl}:`, err.message);
      continue;
    }
  }
  
  throw new Error('Failed to create RPC provider with any endpoint');
}

/**
 * Query latest() from PointerRegistry contract
 * 
 * @param {string} contractAddress - Contract address (e.g., "0x43535E8280C0Ec9e845Cacb456C45f576d6D581a")
 * @param {string} [customRpcUrl] - Optional custom RPC URL
 * @returns {Promise<Object>} Pointer data: { currentVersion, updatedAt, payloadSha256, payloadSize, cid, brefs }
 */
async function queryLatest(contractAddress, customRpcUrl = null) {
  if (!contractAddress || !ethers.isAddress(contractAddress)) {
    throw new Error(`Invalid contract address: ${contractAddress}`);
  }

  const provider = getRpcProvider(customRpcUrl);
  const contract = new ethers.Contract(contractAddress, POINTER_REGISTRY_ABI, provider);

  try {
    // Call latest() - this is a view function, no gas needed
    const result = await contract.latest();
    
    // Convert result to plain object
    return {
      currentVersion: Number(result[0]),
      updatedAt: Number(result[1]),
      payloadSha256: result[2], // bytes32 - keep as hex string
      payloadSize: Number(result[3]),
      cid: result[4], // string
      brefs: result[5] // string[] - base64-encoded URLs
    };
  } catch (err) {
    throw new Error(`Failed to query latest(): ${err.message}`);
  }
}

/**
 * Decode base64-encoded BREF to URL
 */
function decodeBref(bref) {
  try {
    return Buffer.from(bref, 'base64').toString('utf8').trim();
  } catch (err) {
    console.warn(`[onchain-pointer] Failed to decode BREF: ${bref}`, err.message);
    return null;
  }
}

/**
 * Query latest() and decode BREFs to URLs
 * 
 * @param {string} contractAddress - Contract address
 * @param {string} [customRpcUrl] - Optional custom RPC URL
 * @returns {Promise<Object>} Pointer data with decoded URLs: { currentVersion, updatedAt, payloadSha256, payloadSize, cid, brefs, urls }
 */
async function queryLatestWithUrls(contractAddress, customRpcUrl = null) {
  const pointer = await queryLatest(contractAddress, customRpcUrl);
  
  // Decode BREFs to URLs
  const urls = pointer.brefs.map(decodeBref).filter(Boolean);
  
  return {
    ...pointer,
    urls
  };
}

module.exports = {
  queryLatest,
  queryLatestWithUrls,
  decodeBref,
  ARBITRUM_ONE_CHAIN_ID,
  DEFAULT_RPC_ENDPOINTS
};
