/* eslint import/no-extraneous-dependencies: "off" */

import Web3 from 'web3';
import config from 'config';
import logger from './logger.mjs';

export default {
  connection() {
    if (!this.web3) this.connect();
    return this.web3;
  },

  /**
   * Connects to web3 and then sets proper handlers for events
   */
  connect() {
    if (this.web3) return this.web3.currentProvider;

    logger.info(`Blockchain Connecting on ${config.BLOCKCHAIN_URL}...`);
    let provider;
    if (config.BLOCKCHAIN_URL.includes('http')) {
      logger.warn('Using the deprecated http provider');
      provider = new Web3.providers.HttpProvider(
        config.BLOCKCHAIN_URL,
        config.WEB3_PROVIDER_OPTIONS,
      );
    } else {
      provider = new Web3.providers.WebsocketProvider(
        config.BLOCKCHAIN_URL,
        config.WEB3_PROVIDER_OPTIONS,
      );
      provider.on('error', err => logger.error(`web3 error: ${err}`));
      provider.on('connect', () => logger.info('Blockchain Connected ...'));
      provider.on('end', () => logger.info('Blockchain disconnected'));
    }

    this.web3 = new Web3(provider);

    return provider;
  },

  /**
   * Checks the status of connection
   *
   * @return {Boolean} - Resolves to true or false
   */
  isConnected() {
    if (this.web3) {
      return this.web3.eth.net.isListening();
    }
    return false;
  },
  disconnect() {
    this.web3.currentProvider.connection.close();
  },

  async estimateGas(tx) {
    let gas;
    try {
      gas = await this.web3.eth.estimateGas(tx);
      logger.debug(`Gas estimated at ${gas}`);
    } catch (error) {
      gas = config.WEB3_OPTIONS.gas;
      logger.warn({ msg: 'Gas estimation failed, use default', gas });
    }
    gas = Math.ceil(gas * 2); // 50% seems a more than reasonable buffer
    return gas;
  },
  // function to format fee history inspired by https://docs.alchemy.com/docs/how-to-build-a-gas-fee-estimator-using-eip-1559
  formatFeeHistory(result, includePending, historicalBlocks) {
    if (historicalBlocks === undefined) {
      // eslint-disable-next-line no-param-reassign
      historicalBlocks = result.reward.length;
    }

    let blockNum = result.oldestBlock;
    let index = 0;
    const blocks = [];

    while (index < historicalBlocks && index < result.reward.length) {
      blocks.push({
        number: blockNum,
        baseFeePerGas: Number(result.baseFeePerGas[index]),
        gasUsedRatio: Number(result.gasUsedRatio[index]),
        priorityFeePerGas: result.reward[index].map(x => Number(x)),
      });
      blockNum += 1;
      index += 1;
    }

    if (includePending && result.baseFeePerGas.length > historicalBlocks) {
      blocks.push({
        number: 'pending',
        baseFeePerGas: Number(result.baseFeePerGas[historicalBlocks]),
        gasUsedRatio: NaN,
        priorityFeePerGas: [],
      });
    }

    return blocks;
  },

  // function only needed for infura deployment
  // 26-Sep-2024: Updated with basic EIP 1559 support
  async submitRawTransaction(rawTransaction, contractAddress, value = 0) {
    if (!rawTransaction) throw Error('No tx data to sign');
    if (!contractAddress) throw Error('No contract address passed');
    if (!config.WEB3_OPTIONS.from) throw Error('config WEB3_OPTIONS.from is not set');
    if (!config.ETH_PRIVATE_KEY) throw Error('config ETH_PRIVATE_KEY not set');

    const fromAddress = await this.web3.eth.accounts.privateKeyToAccount(config.ETH_PRIVATE_KEY);

    let maxFeePerGas;
    let maxPriorityFeePerGas;
    try {
      const latestBlock = await this.web3.eth.getBlock('latest');
      const feeHistory = await this.web3.eth.getFeeHistory(5, latestBlock.number, [25, 50, 75]);

      const formattedFeeHistory = this.formatFeeHistory(feeHistory, false, 5);
      const latestBlockFee = formattedFeeHistory[formattedFeeHistory.length - 1];

      maxPriorityFeePerGas = Math.max(
        ...latestBlockFee.priorityFeePerGas[2],
        config.WEB3_OPTIONS.gasPrice,
      );
      maxFeePerGas = latestBlockFee.baseFeePerGas + maxPriorityFeePerGas;
    } catch (error) {
      console.warn('Failed to fetch fee history. Using default values from config.');
      maxFeePerGas = config.WEB3_OPTIONS.gasPrice * 2;
      maxPriorityFeePerGas = config.WEB3_OPTIONS.gasPrice;
    }

    const tx = {
      from: fromAddress.address,
      to: contractAddress,
      data: rawTransaction,
      value,
      maxFeePerGas: this.web3.utils.toHex(maxFeePerGas),
      maxPriorityFeePerGas: this.web3.utils.toHex(maxPriorityFeePerGas),
    };
    tx.gas = await this.estimateGas(tx);
    const signed = await this.web3.eth.accounts.signTransaction(tx, config.ETH_PRIVATE_KEY);
    return this.web3.eth.sendSignedTransaction(signed.rawTransaction);
  },
};
