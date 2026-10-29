import path from 'node:path';
import { prepareRecruitmentDataset } from './prepare-dataset.js';
import { trainAndCompareEmailIntelligenceModels } from '../src/ml/trainerPipeline.js';

export async function runCliTrain(rootDir = process.cwd()) {
  const prep = prepareRecruitmentDataset(rootDir);
  console.log(
    `[ml:train] Dataset verified: ${prep.totalCuratedExamples} examples (${prep.splitCounts.train} train / ${prep.splitCounts.val} val / ${prep.splitCounts.test} held-out test), 0 leakage.`
  );

  const result = await trainAndCompareEmailIntelligenceModels({
    rootDir,
    cacheDir: path.join(rootDir, '.models_cache'),
    modelVersion: 'spcr-email-intel-v1.0.0',
    outputArtifactPath: path.join(rootDir, 'ml', 'artifacts', 'recruitment_email_model_v1.json'),
    compareHybridMiniLm: true,
  });

  console.log('\n[ml:train] Validation Model Comparison Summary:');
  for (const c of result.valComparison) {
    console.log(
      `  - ${c.candidateName.padEnd(28)} | macroF1=${c.valMacroF1.toFixed(4)} | acc=${c.valAccuracy.toFixed(
        4
      )} | oppRecall=${c.valRelevantOpportunityRecall.toFixed(4)} | silentDiscard=${c.valSilentOpportunityDiscardRate.toFixed(
        4
      )} | cpuMs=${c.avgCpuLatencyMsPerEmail}`
    );
  }
  console.log(`\n[ml:train] Selection Rationale: ${result.selectionRationale}`);
  console.log(`[ml:train] Exported & verified artifact: ${result.artifactPath} (SHA-256: ${result.artifactFileSha256})`);
  return result;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('train-email-model.ts')) {
  runCliTrain().catch((err) => {
    console.error('[ml:train] Training failed:', err);
    process.exitCode = 1;
  });
}

