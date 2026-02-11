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

    logger.info(`[WEB3] Blockchain Connecting on ${config.BLOCKCHAIN_URL}...`);
    let provider;
    if (config.BLOCKCHAIN_URL.startsWith('ws://') || config.BLOCKCHAIN_URL.startsWith('wss://')) {
      logger.info('[WEB3] Using WebSocket provider for real-time event streaming');
      provider = new Web3.providers.WebsocketProvider(
        config.BLOCKCHAIN_URL,
        config.WEB3_PROVIDER_OPTIONS,
      );
      provider.on('error', err => logger.error(`[WEB3] web3 error: ${err}`));
      provider.on('connect', () => logger.info('[WEB3] Blockchain Connected via WebSocket'));
      provider.on('end', () => logger.info('[WEB3] Blockchain disconnected'));
    } else {
      logger.warn(
        '[WEB3] Using HTTP provider - events will be polled periodically (not real-time)',
      );
      logger.info(`[WEB3] HTTP Provider URL: ${config.BLOCKCHAIN_URL}`);
      // Use HTTP provider for http:// or https:// URLs
      const HTTP_PROVIDER_OPTIONS = {
        keepAlive: true,
        timeout: 3600000,
      };
      provider = new Web3.providers.HttpProvider(config.BLOCKCHAIN_URL, HTTP_PROVIDER_OPTIONS);
      logger.info('[WEB3] HTTP provider initialized. Event subscriptions will use polling.');
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
  // Estimate the EIP 1559 priority fee
  async estimatePriorityFeePerGas(numOfBlocks = 5, desiredSpeed = 'medium') {
    const NUM_BLOCKS = numOfBlocks;
    const PERCENTILES = [25, 50, 75];

    // Retrieve fee history for the last NUM_BLOCKS blocks
    const feeHistory = await this.web3.eth.getFeeHistory(NUM_BLOCKS, 'latest', PERCENTILES);

    // Format the fee history data
    const formattedFeeHistory = this.formatFeeHistory(feeHistory, false, NUM_BLOCKS);

    // Extract the base fees, priority fees, and gas used ratios from the formatted data
    const baseFees = formattedFeeHistory.map(block => block.baseFeePerGas);
    const priorityFees = formattedFeeHistory.map(block => block.priorityFeePerGas);
    const gasUsedRatios = formattedFeeHistory.map(block => block.gasUsedRatio);

    // Calculate the average base fee and gas used ratio
    const avgBaseFee = baseFees.reduce((sum, fee) => sum + fee, 0) / NUM_BLOCKS;
    const avgGasUsedRatio = gasUsedRatios.reduce((sum, ratio) => sum + ratio, 0) / NUM_BLOCKS;

    // Define the minimum priority fee and speed multipliers
    const MIN_PRIORITY_FEE = 1.5e9; // 1.5 Gwei
    const SPEED_MULTIPLIERS = {
      low: 0.5,
      medium: 1,
      high: 1.5,
    };

    // Calculate the priority fee based on the desired speed and recent fee history
    const weightedAvgPriorityFee = priorityFees.reduce((sum, priorityFee, index) => {
      const weight = (index + 1) / NUM_BLOCKS;
      return sum + priorityFee[2] * weight;
    }, 0);

    let estimatedPriorityFee = weightedAvgPriorityFee * SPEED_MULTIPLIERS[desiredSpeed];

    // Adjust the priority fee based on network congestion
    if (avgBaseFee > 100e9 && avgGasUsedRatio > 0.9) {
      estimatedPriorityFee *= 1.2; // Increase by 20% during high congestion
    }

    // Ensure the estimated priority fee is not lower than the minimum
    estimatedPriorityFee = Math.max(estimatedPriorityFee, MIN_PRIORITY_FEE);

    return Math.round(estimatedPriorityFee);
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
      // Log fee history for debugging if enabled in config
      if (config.SHOW_FEE_HISTORY_LOGS === 'true') {
        const feeHistory = await this.web3.eth.getFeeHistory(5, latestBlock.number, [25, 50, 75]);
        logger.debug(feeHistory, 'Fee History');
        const formattedFeeHistory = this.formatFeeHistory(feeHistory, false, 5);
        logger.debug(formattedFeeHistory, 'Formatted Fee History');
      }
      const { baseFeePerGas } = latestBlock;
      logger.debug({ baseFeePerGas }, 'baseFeePerGas');
      maxPriorityFeePerGas = await this.estimatePriorityFeePerGas();
      maxFeePerGas = baseFeePerGas + maxPriorityFeePerGas;
    } catch (error) {
      logger.debug(`Err: ${error.message}`);
      logger.warn('Failed to fetch fee history. Using default values from config.');
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
    logger.debug(
      `Submitting transaction from ${fromAddress.address} to ${contractAddress} with value ${value} and gas ${tx.gas}`,
    );
    const signed = await this.web3.eth.accounts.signTransaction(tx, config.ETH_PRIVATE_KEY);
    return this.web3.eth.sendSignedTransaction(signed.rawTransaction);
  },
};
