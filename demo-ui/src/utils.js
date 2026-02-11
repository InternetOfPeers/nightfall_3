/* eslint import/no-extraneous-dependencies: "off" */

import Web3 from 'web3';
// import logger from './common-files/utils/logger.mjs'; - depends on a non-browsify'able module

/*
 * update mocked logger module to native console
 * as to experience logs from SDK
 */
// logger.info = console.info;
// logger.debug = console.debug;
// logger.error = console.error;
// logger.warn = console.warn;

export function parseBalance(obj, erc20Address) {
  return obj[erc20Address.toLowerCase()]?.[0].balance || 0;
}

export async function getUserBalances(nf3Object, erc20Address) {
  console.log(await nf3Object.getLayer2Balances(), nf3Object);
  const l2Balance = parseBalance(await nf3Object.getLayer2Balances(), erc20Address);
  if (!window.ethereum) {
    console.warn('Wallet extension is not installed. L1 balance unavailable.');
    return { l2Balance, l1Balance: 0 };
  }
  const l1Balance = await window.ethereum.request({
    method: 'eth_getBalance',
    params: [nf3Object.ethereumAddress, 'latest'],
  });
  return { l2Balance, l1Balance: Number(Web3.utils.fromWei(l1Balance, 'ether')).toFixed(8) };
}

export function getWalletEOA() {
  if (!window.ethereum) {
    throw new Error(
      'Wallet extension is not installed. Please install Rabbit Wallet or MetaMask browser extension.',
    );
  }
  return window.ethereum.request({ method: 'eth_requestAccounts' });
}

export function listenWalletEOAChange(callback) {
  if (!window.ethereum) {
    console.warn(
      'Wallet extension is not installed. Please install Rabbit Wallet or MetaMask browser extension.',
    );
    return;
  }
  window.ethereum.on('accountsChanged', callback);
}

export function swithNetwork(chainId) {
  return window.ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [
      {
        chainId: Web3.utils.toHex(Number(chainId)),
      },
    ],
  });
}

export function addNetwork(chainId) {
  switch (Number(chainId)) {
    case 137:
      return window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainName: 'Polygon',
            chainId: Web3.utils.toHex(chainId),
            nativeCurrency: { name: 'MATIC', decimals: 18, symbol: 'MATIC' },
            rpcUrls: [
              'https://rpc.ankr.com/polygon/486f6d938d85e35aeacf83a59afd95c4fab739093c8f919adb258799d81d51bf',
            ],
          },
        ],
      });
    case 296:
      return window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainName: 'Hedera Testnet',
            chainId: Web3.utils.toHex(chainId),
            nativeCurrency: { name: 'HBAR', decimals: 18, symbol: 'HBAR' },
            rpcUrls: ['https://testnet.hashio.io/api'],
          },
        ],
      });
    case 80001:
      return window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainName: 'Mumbai Testnet',
            chainId: Web3.utils.toHex(chainId),
            nativeCurrency: { name: 'MATIC', decimals: 18, symbol: 'MATIC' },
            rpcUrls: ['https://rpc-mumbai.maticvigil.com/'],
          },
        ],
      });
    default:
      console.log('configure logic for this case is missing');
      break;
  }
  return null;
}
