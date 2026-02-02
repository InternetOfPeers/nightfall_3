import Web3 from 'common-files/utils/web3.mjs';
import logger from 'common-files/utils/logger.mjs';
import circuits from './circuit-setup.mjs';
import setupContracts from './contract-setup.mjs';

async function safeSetupContracts() {
  try {
    await setupContracts();
  } catch (err) {
    if (err.message.includes('Transaction has been reverted by the EVM'))
      logger.warn(
        'Writing contract addresses to the State contract failed. This is probably because they are already set. Did you already run deployer?',
      );
    else throw new Error(err);
  }
}

async function setupCircuits() {
  await circuits.waitForWorker();
  console.time('setupCircuits - Execution Time');
  await circuits.setupCircuits();
  console.timeEnd('setupCircuits - Execution Time');
}

async function main() {
  logger.info(`setup circuits`);
  await setupCircuits();
  await safeSetupContracts();
  try {
    const web3Instance = Web3.connection();
    if (web3Instance?.currentProvider?.connection?.close) {
      web3Instance.currentProvider.connection.close();
    }
  } catch (err) {
    logger.warn(
      `Process completed correctly but attempt to clean disconnect web3 failed with error: ${err}`,
    );
  }
  logger.info(`deployer bootstrap done`);
  process.exit(0);
}

main();
