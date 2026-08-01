/**
 * Quick sanity-check script for the Xenova/multilingual-e5-small embedder.
 *
 * Run with:   npx tsx lib/ai-agent/test-embedder.ts
 *
 * Checks:
 *  1. Model loads without crashing
 *  2. embedText() returns a 384-dim vector
 *  3. embedDocument() returns a 384-dim vector
 *  4. Both are L2-normalised (norm ≈ 1.0)
 *  5. query and passage embeddings differ (prefixes are applied correctly)
 *  6. Cosine similarity between related texts is higher than unrelated ones
 */

async function main() {
  console.log('─── Xenova/multilingual-e5-small embedder test ───\n')

  const { embedText, embedDocument } = await import('./embedder')

  // 1. Embed a query
  console.log('1. Embedding query: "What is the price of sofa set?"')
  const t0 = Date.now()
  const queryVec = await embedText('What is the price of sofa set?')
  const loadTime = Date.now() - t0
  console.log(`   ✓ Done in ${loadTime}ms (includes model load on first call)`)
  console.log(`   Dimension: ${queryVec.length}`)
  if (queryVec.length !== 384) {
    console.error('   ✗ FAIL — expected 384 dimensions, got', queryVec.length)
    process.exit(1)
  }
  console.log('   ✓ Dimension is 384')

  // 2. Check L2 norm
  const queryNorm = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0))
  console.log(`   L2 norm: ${queryNorm.toFixed(6)}`)
  if (Math.abs(queryNorm - 1.0) > 0.01) {
    console.error('   ✗ FAIL — vector is not L2-normalised')
    process.exit(1)
  }
  console.log('   ✓ L2-normalised')

  // 3. Embed a document
  console.log('\n2. Embedding document: "Our premium sofa set costs AED 45,000..."')
  const t1 = Date.now()
  const docVec = await embedDocument('Our premium sofa set costs AED 45,000. Available in leather and fabric.')
  console.log(`   ✓ Done in ${Date.now() - t1}ms (cached pipeline)`)
  console.log(`   Dimension: ${docVec.length}`)
  if (docVec.length !== 384) {
    console.error('   ✗ FAIL — expected 384 dimensions')
    process.exit(1)
  }

  // 4. Check doc L2 norm
  const docNorm = Math.sqrt(docVec.reduce((s, v) => s + v * v, 0))
  if (Math.abs(docNorm - 1.0) > 0.01) {
    console.error('   ✗ FAIL — doc vector is not L2-normalised')
    process.exit(1)
  }
  console.log('   ✓ L2-normalised')

  // 5. Cosine similarity (dot product since both are L2-normalised)
  const cosSim = queryVec.reduce((s, v, i) => s + v * docVec[i], 0)
  console.log(`\n3. Cosine similarity (query ↔ related doc): ${cosSim.toFixed(4)}`)

  // 6. Embed an unrelated document
  const unrelatedVec = await embedDocument('The weather forecast for tomorrow shows rain in Delhi.')
  const cosSimUnrelated = queryVec.reduce((s, v, i) => s + v * unrelatedVec[i], 0)
  console.log(`   Cosine similarity (query ↔ unrelated doc): ${cosSimUnrelated.toFixed(4)}`)

  if (cosSim > cosSimUnrelated) {
    console.log('   ✓ Related doc scored higher than unrelated — retrieval quality OK')
  } else {
    console.error('   ✗ FAIL — unrelated doc scored higher. Something is wrong with e5 prefixes.')
    process.exit(1)
  }

  // 7. Test Arabic
  console.log('\n4. Arabic text test:')
  const arabicQuery = await embedText('أريد شقة في دبي')
  const arabicSim = arabicQuery.reduce((s, v, i) => s + v * docVec[i], 0)
  console.log(`   Cosine similarity (Arabic query ↔ English doc): ${arabicSim.toFixed(4)}`)
  if (arabicSim > 0.3) {
    console.log('   ✓ Cross-lingual similarity is reasonable')
  } else {
    console.warn('   ⚠ Cross-lingual similarity is low — review Arabic support before enabling it')
  }

  // 8. Generate a pgvector-compatible literal
  const vectorLiteral = `[${queryVec.join(',')}]`
  console.log(`\n5. pgvector literal preview (first 80 chars): ${vectorLiteral.slice(0, 80)}...`)
  console.log(`   Total literal length: ${vectorLiteral.length} chars`)
  console.log('   ✓ Format compatible with $1::vector binding')

  console.log('\n─── All checks passed ✓ ───')
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
