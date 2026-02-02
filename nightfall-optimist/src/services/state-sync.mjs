/* eslint-disable no-await-in-loop */
/* eslint-disable import/no-cycle */

import config from 'config';
import { getContractInstance, waitForContract } from 'common-files/utils/contract.mjs';
import constants from 'common-files/constants/index.mjs';
import { pauseQueue, unpauseQueue, queues, flushQueue } from 'common-files/utils/event-queue.mjs';
import logger from 'common-files/utils/logger.mjs';
import blockProposedEventHandler from '../event-handlers/block-proposed.mjs';
import transactionSubmittedEventHandler from '../event-handlers/transaction-submitted.mjs';
import newCurrentProposerEventHandler from '../event-handlers/new-current-proposer.mjs';
import committedToChallengeEventHandler from '../event-handlers/challenge-commit.mjs';
import rollbackEventHandler from '../event-handlers/rollback.mjs';
import { getBlockByBlockNumberL2, getBlocks, getLatestBlockInfo } from './database.mjs';
import { stopMakingChallenges, startMakingChallenges } from './challenges.mjs';

// TODO can we remove these await-in-loops?

const {
  SHIELD_CONTRACT_NAME,
  PROPOSERS_CONTRACT_NAME,
  STATE_CONTRACT_NAME,
  CHALLENGES_CONTRACT_NAME,
} = constants;

const { STATE_GENESIS_BLOCK } = config;
const GENESIS_BLOCK = STATE_GENESIS_BLOCK || 0;

export async function syncState(
  proposer,
  fromBlock = 'earliest',
  toBlock = 'latest',
  eventFilter = 'allEvents',
) {
  logger.info({
    msg: '[SYNC] Starting state sync with parameters',
    fromBlock,
    toBlock,
    eventFilter,
  });
  // Resolve 'earliest' to STATE_GENESIS_BLOCK instead of block 0
  const resolvedFromBlock = fromBlock === 'earliest' ? GENESIS_BLOCK : fromBlock;
  logger.debug({
    msg: '[SYNC] Resolved fromBlock',
    original: fromBlock,
    resolved: resolvedFromBlock,
    genesisBlock: GENESIS_BLOCK,
  });
  const proposersContractInstance = await getContractInstance(PROPOSERS_CONTRACT_NAME); // NewCurrentProposer (register)
  const shieldContractInstance = await getContractInstance(SHIELD_CONTRACT_NAME); // TransactionSubmitted
  const stateContractInstance = await getContractInstance(STATE_CONTRACT_NAME); // NewCurrentProposer, BlockProposed
  const challengesContractInstance = await getContractInstance(CHALLENGES_CONTRACT_NAME); // NewCurrentProposer, BlockProposed
  logger.debug(
    `[SYNC] Fetching past events from Shield contract at ${shieldContractInstance.options.address}`,
  );
  const [pastProposerEvents, pastShieldEvents, pastStateEvents, pastChallengeEvents] =
    await Promise.all([
      proposersContractInstance.getPastEvents(eventFilter, {
        fromBlock: resolvedFromBlock,
        toBlock,
      }),
      shieldContractInstance.getPastEvents(eventFilter, {
        fromBlock: resolvedFromBlock,
        toBlock,
      }),
      stateContractInstance.getPastEvents(eventFilter, {
        fromBlock: resolvedFromBlock,
        toBlock,
      }),
      challengesContractInstance.getPastEvents(eventFilter, {
        fromBlock: resolvedFromBlock,
        toBlock,
      }),
    ]);

  logger.info(
    `[SYNC] Found ${pastShieldEvents.length} Shield events (including TransactionSubmitted)`,
  );
  logger.info(
    `[SYNC] Found ${pastProposerEvents.length} Proposer events, ${pastStateEvents.length} State events, ${pastChallengeEvents.length} Challenge events`,
  );

  // Put all events together and sort chronologically as they appear on Ethereum
  const splicedList = pastProposerEvents
    .concat(pastShieldEvents)
    .concat(pastStateEvents)
    .concat(pastChallengeEvents)
    .sort((a, b) => a.blockNumber - b.blockNumber);

  logger.trace(`[SYNC] Replaying total ${splicedList.length} past events in chronological order`);
  for (let i = 0; i < splicedList.length; i++) {
    const pastEvent = splicedList[i];
    logger.debug(
      `[SYNC] Processing event ${i + 1}/${splicedList.length}: ${pastEvent.event} at block ${
        pastEvent.blockNumber
      }, txHash: ${pastEvent.transactionHash}`,
    );
    switch (pastEvent.event) {
      case 'NewCurrentProposer':
        await newCurrentProposerEventHandler(pastEvent, [proposer]);
        break;
      case 'Rollback':
        await rollbackEventHandler(pastEvent);
        break;
      case 'TransactionSubmitted':
        logger.debug(
          `[SYNC] Processing TransactionSubmitted from sync - txHash: ${pastEvent.transactionHash}, block: ${pastEvent.blockNumber}`,
        );
        await transactionSubmittedEventHandler(pastEvent);
        break;
      case 'BlockProposed':
        await blockProposedEventHandler(pastEvent);
        break;
      case 'CommittedToChallenge':
        await committedToChallengeEventHandler(pastEvent);
        break;
      default:
        break;
    }
  }
  logger.info(`[SYNC] ===== State sync complete =====`);
}

const checkBlocks = async () => {
  const blocks = await getBlocks();
  const gapArray = [];
  if (blocks.length > 0) {
    // Existing blocks found stored locally
    let expectedLeafCount = 0;
    // Loop through all our blocks to find any gaps in our internal block data
    for (let i = 0; i < blocks.length - 1; i++) {
      // If the leafCount of the next block stored internally does not match what we expect the leaf count to be
      // it means we may have a gap in our blockData
      expectedLeafCount += blocks[i].nCommitments;
      if (blocks[i].leafCount !== expectedLeafCount) {
        // if we are in the first iteration it means we have a problem with our internal data
        // let's just restart the sync from STATE_GENESIS_BLOCK,
        // else let's just scan from the Ethereum blockNumber that is one more than our known correct block.
        const fromBlock = i === 0 ? GENESIS_BLOCK : blocks[i - 1].blockNumber + 1;
        // we will scan the gap up to the blockNumber of the current blocks
        const toBlock = blocks[i].blockNumber - 1;
        gapArray.push([fromBlock, toBlock]);
        // reset so we can find more
        expectedLeafCount = blocks[i].leafCount;
      }
    }
    if (gapArray.length > 0) return gapArray; // We found some missing blocks
    const fromBlock = blocks[blocks.length - 1].blockNumber + 1;
    return [[fromBlock, 'latest']];
  }
  logger.info(`[SYNC] No blocks found locally. Starting from STATE_GENESIS_BLOCK=${GENESIS_BLOCK}`);
  return [[GENESIS_BLOCK, 'latest']];
};

export async function initialBlockSync(proposer) {
  logger.info('[SYNC] ===== Starting initialBlockSync =====');

  const stateContractInstance = await waitForContract(STATE_CONTRACT_NAME);
  const lastBlockNumberL2 = Number(
    (await stateContractInstance.methods.getNumberOfL2Blocks().call()) - 1,
  );

  logger.info(`[SYNC] Last L2 block number on-chain: ${lastBlockNumberL2}`);

  if (lastBlockNumberL2 === -1) {
    logger.info(
      '[SYNC] Blockchain is empty (no L2 blocks). Unpausing queues to listen for new events.',
    );
    unpauseQueue(0); // queues are started paused, therefore we need to unpause them before proceeding.
    unpauseQueue(1);
    try {
      startMakingChallenges();
    } catch (err) {
      // ignore the error
    }
    return null; // The blockchain is empty
  }
  // pause the queues so we stop processing incoming events while we sync
  await Promise.all([pauseQueue(0), pauseQueue(1)]);

  logger.info('[SYNC] ===== Begining synchronisation with the blockchain =====');

  const missingBlocks = await checkBlocks(); // Stores any gaps of missing blocks
  const latestBlockLocally = (await getBlockByBlockNumberL2(lastBlockNumberL2)) ?? undefined;

  if (!latestBlockLocally || missingBlocks[0] !== latestBlockLocally.blockNumber + 1) {
    // The latest block stored locally does not match the last on-chain block
    // or we have detected a gap in the L2 blockchain
    stopMakingChallenges();
    for (let i = 0; i < missingBlocks.length; i++) {
      const [fromBlock, toBlock] = missingBlocks[i];
      // Sync the state inbetween these blocks
      await syncState(proposer, fromBlock, toBlock);
    }

    /*
     at this point, we have synchronised all the existing blocks. If there are no outstanding
     challenges (all rollbacks have completed) then we're done.  It's possible however that
     we had a bad block that was not rolled back. If this is the case then there will still be
     a challenge in the stop queue that was not removed by a rollback.
     If this is the case we'll run the stop queue to challenge the bad block.
    */
    try {
      startMakingChallenges();
    } catch (err) {
      // ignore the error
    }
    if (queues[2].length === 0)
      logger.info('[SYNC] After synchronisation, no challenges remain unresolved');
    else {
      logger.info(
        `[SYNC] After synchronisation, there were ${queues[2].length} unresolved challenges.  Running them now.`,
      );

      // start queue[2] and await all the unresolved challenges being run
      const p = flushQueue(2);
      queues[2].start();
      await p;
      logger.debug('[SYNC] All challenges in the stop queue have now been made.');
    }
  }
  const currentProposer = (await stateContractInstance.methods.currentProposer().call())
    .thisAddress;
  if (currentProposer !== proposer.address) {
    await newCurrentProposerEventHandler({ returnValues: { proposer: currentProposer } }, [
      proposer,
    ]);
  }

  logger.info('[SYNC] Unpausing event queues to process new incoming events');
  unpauseQueue(0);
  unpauseQueue(1);
  logger.info('[SYNC] ===== initialBlockSync complete =====');

  return (await getLatestBlockInfo()).blockNumber;
}
