import fs from 'fs';
import path from 'path';
import logger from 'common-files/utils/logger.mjs';
import downloadFile from 'common-files/utils/httputils.mjs';
import * as snarkjs from 'snarkjs';
import compile from '../utils/compile.mjs';

export default async function generateKeys({ filepath }) {
  const outputPath = `./output`;
  const circuitsPath = `./circuits`;

  const ext = path.extname(filepath);
  const circuitName = path.basename(filepath, '.circom'); // filename without '.circom'
  const circuitDir = filepath.replace(ext, '');

  fs.mkdirSync(`${outputPath}/${circuitDir}`, { recursive: true });

  logger.info({
    msg: 'Compiling circuits...',
    circuitsPath: `${circuitsPath}/${filepath}`,
    outputPath: `${outputPath}/${circuitDir}`,
    circuitName: `${circuitName}`,
  });

  await compile(`${circuitsPath}/${filepath}`, `${outputPath}/${circuitDir}`);

  logger.info('Setup...');

  const r1csInfo = await snarkjs.r1cs.info(`${outputPath}/${circuitDir}/${circuitName}.r1cs`);
  const power = Math.ceil(Math.log2(r1csInfo.nVars)).toString().padStart(2, '0');

  // Download PowersOfTau from multiple sources (with fallback)
  if (!fs.existsSync(`${outputPath}/powersOfTau28_hez_final_${power}.ptau`)) {
    logger.info(`Downloading powersOfTau with power ${power}`);

    // Try multiple sources in order
    const sources = [
      {
        name: 'SnarkJS Storage',
        url: `https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_${power}.ptau`,
      },
      {
        name: 'Polygon zkEVM (GitHub)',
        url: `https://github.com/iden3/snarkjs/raw/master/powersOfTau/powersOfTau28_hez_final_${power}.ptau`,
      },
      {
        name: 'Hermez S3 (legacy)',
        url: `https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_${power}.ptau`,
      },
    ];

    let downloaded = false;
    let lastError;

    for (const source of sources) {
      try {
        logger.info(`Trying to download from: ${source.name}`);
        // eslint-disable-next-line no-await-in-loop
        await downloadFile(source.url, `${outputPath}/powersOfTau28_hez_final_${power}.ptau`);
        logger.info(`Successfully downloaded from: ${source.name}`);
        downloaded = true;
        break;
      } catch (error) {
        logger.warn(`Failed to download from ${source.name}: ${error.message}`);
        lastError = error;
        // Clean up partial download if any
        if (fs.existsSync(`${outputPath}/powersOfTau28_hez_final_${power}.ptau`)) {
          fs.unlinkSync(`${outputPath}/powersOfTau28_hez_final_${power}.ptau`);
        }
      }
    }

    if (!downloaded) {
      logger.error('Failed to download Powers of Tau from all sources');
      logger.error('For workshop/demo purposes, you can generate a small test file:');
      logger.error(
        `  cd /app/output && npx snarkjs powersoftau new bn128 ${power} pot${power}_0000.ptau -v`,
      );
      logger.error(
        `  npx snarkjs powersoftau prepare phase2 pot${power}_0000.ptau powersOfTau28_hez_final_${power}.ptau -v`,
      );
      throw lastError;
    }
  }

  logger.info('Generating keys...');
  await snarkjs.zKey.newZKey(
    `${outputPath}/${circuitDir}/${circuitName}.r1cs`,
    `${outputPath}/powersOfTau28_hez_final_${power}.ptau`,
    `${outputPath}/${circuitDir}/${circuitName}.zkey`,
  );

  logger.info('Exporting verification Key...');
  const vk = await snarkjs.zKey.exportVerificationKey(
    `${outputPath}/${circuitDir}/${circuitName}.zkey`,
  );

  logger.info('Key generation completed');

  return { vk, filepath };
}
