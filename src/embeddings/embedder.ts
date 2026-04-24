import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { mkdirSync } from 'node:fs';

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

let _extractor: FeatureExtractionPipeline | null = null;
let _loading: Promise<FeatureExtractionPipeline> | null = null;

function getCacheDir(): string {
  const dir = process.env['BRAIN2_MODEL_CACHE'] || `${process.env['HOME']}/Code/brain2/data/models`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function loadModel(): Promise<FeatureExtractionPipeline> {
  if (_extractor) return _extractor;
  if (_loading) return _loading;

  _loading = pipeline('feature-extraction', MODEL_NAME, {
    cache_dir: getCacheDir(),
    quantized: true,
  });

  _extractor = await _loading;
  _loading = null;
  return _extractor;
}

export async function embed(text: string): Promise<Float32Array> {
  const extractor = await loadModel();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data as Float64Array);
}

export async function embedBatch(texts: string[], batchSize = 32): Promise<Float32Array[]> {
  const extractor = await loadModel();
  const results: Float32Array[] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    const dim = output.dims[1];
    for (let j = 0; j < batch.length; j++) {
      const start = j * dim;
      const vec = new Float32Array(dim);
      for (let k = 0; k < dim; k++) {
        vec[k] = output.data[start + k] as number;
      }
      results.push(vec);
    }
  }

  return results;
}

export async function warmup(): Promise<void> {
  await loadModel();
}
