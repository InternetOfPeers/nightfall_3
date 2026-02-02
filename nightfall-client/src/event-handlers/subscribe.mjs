/* eslint-disable no-await-in-loop */

/**
 * Module to subscribe to blockchain events
 */
import { waitForContract } from 'common-files/utils/contract.mjs';
import constants from 'common-files/constants/index.mjs';
import logger from 'common-files/utils/logger.mjs';
import Web3 from 'common-files/utils/web3.mjs';

const {
  STATE_CONTRACT_NAME,
  CHALLENGES_CONTRACT_NAME,
  SHIELD_CONTRACT_NAME,
  PROPOSERS_CONTRACT_NAME,
} = constants;

// Polling configuration for HTTP providers
const POLLING_INTERVAL = 5000; // Poll every 5 seconds
// eslint-disable-next-line no-unused-vars
let pollingIntervalId = null;
let lastPolledBlock = null;

/**
 * Poll for new events when using HTTP provider
 */
async function pollForEvents(contracts, contractNames, callback, arg) {
  try {
    const web3 = Web3.connection();
    const currentBlock = await web3.eth.getBlockNumber();

    // Initialize lastPolledBlock if not set
    if (lastPolledBlock === null) {
      lastPolledBlock = currentBlock - 1; // Start from previous block
      logger.info(`[CLIENT-EVENTS] Starting event polling from block ${lastPolledBlock}`);
    }

    // Don't poll if we're already at the latest block
    if (currentBlock <= lastPolledBlock) {
      return;
    }

    const fromBlock = lastPolledBlock + 1;
    const toBlock = currentBlock;

    logger.debug(`[CLIENT-EVENTS] Polling for events from block ${fromBlock} to ${toBlock}`);

    // Fetch events from all contracts in parallel
    const allEventsPromises = contracts.map(async (contract, index) => {
      const contractName = contractNames[index];
      try {
        const events = await contract.getPastEvents('allEvents', {
          fromBlock,
          toBlock,
        });

        if (events.length > 0) {
          logger.info(
            `[CLIENT-EVENTS] Found ${events.length} events from ${contractName} in blocks ${fromBlock}-${toBlock}`,
          );
        }

        return events;
      } catch (err) {
        logger.error(`[CLIENT-EVENTS] Error polling ${contractName}: ${err.message}`);
        return [];
      }
    });

    const allEventsArrays = await Promise.all(allEventsPromises);
    const allEvents = allEventsArrays.flat().sort((a, b) => {
      // Sort by block number, then by log index
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      return a.logIndex - b.logIndex;
    });

    // Process each event
    for (const event of allEvents) {
      logger.info(
        `[CLIENT-EVENTS] Event received: ${event.event}, txHash: ${event.transactionHash}, block: ${event.blockNumber}`,
      );
      callback(event, arg);
    }

    // Update last polled block
    lastPolledBlock = currentBlock;
  } catch (err) {
    logger.error(`[CLIENT-EVENTS] Error in polling cycle: ${err.message}`);
  }
}

// eslint-disable-next-line import/prefer-default-export
export async function startEventQueue(callback, ...args) {
  const contractNames = [
    STATE_CONTRACT_NAME,
    SHIELD_CONTRACT_NAME,
    CHALLENGES_CONTRACT_NAME,
    PROPOSERS_CONTRACT_NAME,
  ];

  logger.info('[CLIENT-EVENTS] Setting up blockchain event subscriptions...');
  logger.info(`[CLIENT-EVENTS] Subscribing to contracts: ${contractNames.join(', ')}`);

  const contracts = await Promise.all(contractNames.map(c => waitForContract(c)));

  logger.info(`[CLIENT-EVENTS] Contract instances obtained. Setting up event emitters...`);

  // Check if we're using HTTP provider
  const web3 = Web3.connection();
  const provider = web3.currentProvider;
  const isHttpProvider =
    provider.constructor.name === 'HttpProvider' ||
    !provider.supportsSubscriptions ||
    (!provider.constructor.name.includes('Websocket') &&
      !provider.constructor.name.includes('WebSocket'));

  if (isHttpProvider) {
    logger.info('[CLIENT-EVENTS] HTTP provider detected - using polling mechanism');
    logger.info(`[CLIENT-EVENTS] Polling interval: ${POLLING_INTERVAL} ms`);

    // Log contract addresses for debugging
    contracts.forEach((contract, index) => {
      logger.info(
        `[CLIENT-EVENTS] Will poll ${contractNames[index]} at ${contract.options.address}`,
      );
    });

    // Start polling
    pollingIntervalId = setInterval(() => {
      pollForEvents(contracts, contractNames, callback, args);
    }, POLLING_INTERVAL);

    // Do initial poll immediately
    pollForEvents(contracts, contractNames, callback, args);

    logger.info('[CLIENT-EVENTS] Event polling started (HTTP provider mode)');

    return null; // No emitters for HTTP polling
  }

  // WebSocket provider - use subscriptions
  logger.info('[CLIENT-EVENTS] WebSocket provider detected - using event subscriptions');

  const emitters = contracts.map((e, index) => {
    const contractName = contractNames[index];
    const emitterC = e.events.allEvents();

    emitterC.on('changed', event => {
      logger.info(`[CLIENT-EVENTS] Event 'changed' received from ${contractName}: ${event.event}`);
      callback(event, args);
    });

    emitterC.on('data', event => {
      logger.info(
        `[CLIENT-EVENTS] Event 'data' received from ${contractName}: ${event.event}, txHash: ${event.transactionHash}`,
      );
      callback(event, args);
    });

    emitterC.on('error', error => {
      logger.error(
        `[CLIENT-EVENTS] Event subscription error for ${contractName}: ${error.message}`,
      );
    });

    logger.info(
      `[CLIENT-EVENTS] Subscribed to all events from ${contractName} at ${e.options.address}`,
    );
    return emitterC;
  });

  logger.info('[CLIENT-EVENTS] Successfully subscribed to all layer 2 contract events');

  return emitters;
}
