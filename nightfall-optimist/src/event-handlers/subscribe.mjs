/* eslint-disable no-await-in-loop */

/**
 * Module to subscribe to blockchain events
 */
import WebSocket from 'ws';
import config from 'config';
import logger from 'common-files/utils/logger.mjs';
import constants from 'common-files/constants/index.mjs';
import { waitForContract } from 'common-files/utils/contract.mjs';
import Web3 from 'common-files/utils/web3.mjs';

const {
  PROPOSERS_CONTRACT_NAME,
  SHIELD_CONTRACT_NAME,
  CHALLENGES_CONTRACT_NAME,
  STATE_CONTRACT_NAME,
} = constants;
const { WEBSOCKET_PORT, WEBSOCKET_PING_TIME } = config;
const wss = new WebSocket.Server({ port: WEBSOCKET_PORT });

// Polling configuration for HTTP providers
const POLLING_INTERVAL = 5000; // Poll every 5 seconds
// eslint-disable-next-line no-unused-vars
let pollingIntervalId = null;
let lastPolledBlock = null;

/**
 * Function that does some standardised setting up of a websocket's events.
 * It logs open, close and error events, sets up a ping and logs the pong. It will
 * close the socket on pong failure.  The user is expected to handle the reconnect.
 * It does not set up the onmessage event because this tends to be case-specific.
 */
function setupWebsocketEvents(ws, socketName) {
  let timeoutID;
  // setup a pinger to ping the websocket correspondent
  const intervalID = setInterval(() => {
    ws.ping();
    // set up a timeout - will close the websocket, which will trigger a reconnect
    timeoutID = setTimeout(() => {
      logger.warn({ msg: 'Timed out waiting for ping response', socketName });
      ws.terminate();
    }, 2 * WEBSOCKET_PING_TIME);
  }, WEBSOCKET_PING_TIME);

  // check we received a pong in time (clears the timer set by the pinger)
  ws.on('pong', () => {
    clearTimeout(timeoutID);
  });
  ws.on('error', () => {
    logger.debug(`ERROR ${socketName}`);
  });
  ws.on('open', () => {
    logger.debug(`OPEN ${socketName}`);
  });
  ws.on('close', err => {
    logger.debug(`CLOSE ${socketName} ${err}`);
    clearInterval(intervalID);
  });
}

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
      logger.info(`[EVENTS] Starting event polling from block ${lastPolledBlock}`);
    }

    // Don't poll if we're already at the latest block
    if (currentBlock <= lastPolledBlock) {
      return;
    }

    const fromBlock = lastPolledBlock + 1;
    const toBlock = currentBlock;

    logger.debug(`[EVENTS] Polling for events from block ${fromBlock} to ${toBlock}`);

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
            `[EVENTS] Found ${events.length} events from ${contractName} in blocks ${fromBlock}-${toBlock}`,
          );
        }

        return events;
      } catch (err) {
        logger.error(`[EVENTS] Error polling ${contractName}: ${err.message}`);
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
        `[EVENTS] Event received: ${event.event}, txHash: ${event.transactionHash}, block: ${event.blockNumber}`,
      );
      callback(event, arg);
    }

    // Update last polled block
    lastPolledBlock = currentBlock;
  } catch (err) {
    logger.error(`[EVENTS] Error in polling cycle: ${err.message}`);
  }
}

/**
 *
 * @param callback - The function that distributes events to the event-handler function
 * @param arg - List of arguments to be passed to callback, the first element must be the event-handler functions
 * @returns = List of emitters from each contract (or null for HTTP polling).
 */
export async function startEventQueue(callback, ...arg) {
  const contractNames = [
    STATE_CONTRACT_NAME,
    SHIELD_CONTRACT_NAME,
    CHALLENGES_CONTRACT_NAME,
    PROPOSERS_CONTRACT_NAME,
  ];

  logger.info('[EVENTS] Setting up blockchain event subscriptions...');
  logger.info(`[EVENTS] Subscribing to contracts: ${contractNames.join(', ')}`);

  const contracts = await Promise.all(contractNames.map(c => waitForContract(c)));

  logger.info(`[EVENTS] Contract instances obtained. Setting up event emitters...`);

  // Check if we're using HTTP provider
  const web3 = Web3.connection();
  const provider = web3.currentProvider;
  const isHttpProvider =
    provider.constructor.name === 'HttpProvider' ||
    !provider.supportsSubscriptions ||
    (!provider.constructor.name.includes('Websocket') &&
      !provider.constructor.name.includes('WebSocket'));

  if (isHttpProvider) {
    logger.info('[EVENTS] HTTP provider detected - using polling mechanism');
    logger.info(`[EVENTS] Polling interval: ${POLLING_INTERVAL} ms`);

    // Log contract addresses for debugging
    contracts.forEach((contract, index) => {
      logger.info(`[EVENTS] Will poll ${contractNames[index]} at ${contract.options.address}`);
    });

    // Start polling
    pollingIntervalId = setInterval(() => {
      pollForEvents(contracts, contractNames, callback, arg);
    }, POLLING_INTERVAL);

    // Do initial poll immediately
    pollForEvents(contracts, contractNames, callback, arg);

    logger.info('[EVENTS] Event polling started (HTTP provider mode)');

    return null; // No emitters for HTTP polling
  }

  // WebSocket provider - use subscriptions
  logger.info('[EVENTS] WebSocket provider detected - using event subscriptions');

  const emitters = contracts.map((e, index) => {
    const contractName = contractNames[index];
    const emitterC = e.events.allEvents();

    emitterC.on('changed', event => {
      logger.info(`[EVENTS] Event 'changed' received from ${contractName}: ${event.event}`);
      callback(event, arg);
    });

    emitterC.on('data', event => {
      logger.info(
        `[EVENTS] Event 'data' received from ${contractName}: ${event.event}, txHash: ${event.transactionHash}`,
      );
      callback(event, arg);
    });

    emitterC.on('error', error => {
      logger.error(`[EVENTS] Event subscription error for ${contractName}: ${error.message}`);
    });

    logger.info(`[EVENTS] Subscribed to all events from ${contractName} at ${e.options.address}`);
    return emitterC;
  });

  logger.info('[EVENTS] Successfully subscribed to all layer 2 contract events');

  return emitters;
}

export async function subscribeToChallengeWebSocketConnection(callback, ...args) {
  wss.on('connection', ws => {
    ws.on('message', message => {
      if (message === 'challenge') {
        setupWebsocketEvents(ws, 'challenge');
        callback(ws, args);
      }
    });
  });
  logger.debug('Subscribed to Challenge WebSocket connection');
}

export async function subscribeToBlockAssembledWebSocketConnection(callback, ...args) {
  wss.on('connection', ws => {
    ws.on('message', message => {
      if (message === 'blocks') {
        logger.info(
          '[WEBSOCKET] New proposer client connected via websocket with message="blocks"',
        );
        setupWebsocketEvents(ws, 'proposer');
        callback(ws, args);
      }
    });
  });
  logger.debug('Subscribed to BlockAssembled WebSocket connection');
  logger.info(
    '[WEBSOCKET] Listening for proposer connections on websocket (awaiting "blocks" message)',
  );
}

export async function subscribeToInstantWithDrawalWebSocketConnection(callback, ...args) {
  wss.on('connection', ws => {
    ws.on('message', message => {
      if (message === 'instant') {
        setupWebsocketEvents(ws, 'liquidity provider');
        callback(ws, args);
      }
    });
  });
  logger.debug('Subscribed to InstantWithDrawal WebSocket connection');
}

export async function subscribeToProposedBlockWebSocketConnection(callback, ...args) {
  wss.on('connection', ws => {
    ws.on('message', message => {
      // Ignore handshake messages for other WebSocket handlers (e.g., "blocks", "challenge", "instant")
      if (typeof message === 'string' && ['blocks', 'challenge', 'instant'].includes(message)) {
        return; // Silently ignore - handled by other subscription handlers
      }

      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'sync') {
          logger.info(`Subscribing to ProposedBlock`);

          setupWebsocketEvents(ws, 'publisher');
          callback(ws, args);
        }
      } catch (error) {
        // Only log if it's not a known handshake message
        logger.debug({
          msg: 'Not a JSON Message',
          message,
          error,
        });
      }
    });
  });
  logger.debug('Subscribed to ProposedBlock WebSocket connection');
}
