/**
 * lib/ai-agent/embedder.ts
 *
 * Local embedding with Xenova/multilingual-e5-small (Transformers.js / ONNX).
 *
 * Why this model:
 *   - 384-dim vectors, ~120 MB on disk — memory-efficient on a 16 GB VPS
 *   - Handles English + Arabic (multilingual) natively
 *   - Runs fully offline — no API key, no quota, no cost
 *
 * e5 prefix rules (critical — wrong prefixes silently tank retrieval quality):
 *   - Documents at index time → "passage: <text>"
 *   - Incoming queries at search time → "query: <text>"
 *
 * Implementation notes:
 *   - The pipeline is loaded ONCE as a module-level singleton and reused for
 *     every call. First call takes 2–3 s to load the ONNX weights; subsequent
 *     calls are near-instant.
 *   - We mean-pool the token embeddings and L2-normalise so cosine similarity
 *     equals dot-product, which is what pgvector's <=> operator measures.
 *   - Input text is truncated to 512 tokens by the tokeniser automatically;
 *     we also hard-cap at 2 000 characters before tokenisation just in case.
 */

import type { FeatureExtractionPipeline } from '@xenova/transformers'

// ── Singleton pipeline ──────────────────────────────────────────────────────

let _pipeline: FeatureExtractionPipeline | null = null
let _loading: Promise<FeatureExtractionPipeline> | null = null

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (_pipeline) return _pipeline
  if (_loading) return _loading

  _loading = (async () => {
    const { pipeline } = await import('@xenova/transformers')
    console.log('[embedder] Loading Xenova/multilingual-e5-small (first call — may take a few seconds)…')
    const p = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
      // quantized ONNX is the default; it is ~30 MB and fast enough
      quantized: true,
    }) as FeatureExtractionPipeline
    _pipeline = p
    console.log('[embedder] Xenova/multilingual-e5-small loaded ✓')
    return p
  })()

  return _loading
}

// ── Math helpers ─────────────────────────────────────────────────────────────

/**
 * Mean-pool a 2-D tensor (tokens × dim) → 1-D array (dim,).
 * The tensor from @xenova/transformers has shape [batch, tokens, dim].
 */
function meanPool(tensor: { data: Float32Array; dims: number[] }): number[] {
  const [, seqLen, hiddenSize] = tensor.dims
  const output = new Array<number>(hiddenSize).fill(0)

  for (let t = 0; t < seqLen; t++) {
    for (let h = 0; h < hiddenSize; h++) {
      output[h] += tensor.data[t * hiddenSize + h]
    }
  }
  for (let h = 0; h < hiddenSize; h++) {
    output[h] /= seqLen
  }
  return output
}

/** L2-normalise a vector in-place and return it. */
function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (norm === 0) return vec
  for (let i = 0; i < vec.length; i++) vec[i] /= norm
  return vec
}

// ── Core embed function ───────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const pipe = await getPipeline()

  // Hard-cap input length before tokenisation
  const capped = text.slice(0, 2000)

  // @xenova/transformers returns a Tensor; { pooling: 'none' } gives us the
  // full token-level output so we can mean-pool ourselves.
  const output = await pipe(capped, { pooling: 'none', normalize: false })

  const pooled = meanPool(output as unknown as { data: Float32Array; dims: number[] })
  return l2Normalize(pooled)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embed a customer query — prefix "query: " as required by e5.
 * Call this before pgvector similarity search.
 */
export async function embedText(text: string): Promise<number[]> {
  return embed(`query: ${text}`)
}

/**
 * Embed a knowledge document chunk — prefix "passage: " as required by e5.
 * Call this during knowledge-base indexing.
 */
export async function embedDocument(text: string): Promise<number[]> {
  return embed(`passage: ${text}`)
}
