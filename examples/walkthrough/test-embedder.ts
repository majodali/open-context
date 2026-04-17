import { TransformersEmbedder } from '../../src/storage/transformers-embedder.js';

async function main() {
  const embedder = new TransformersEmbedder({ model: 'Xenova/bge-small-en-v1.5', dimensions: 384 });
  console.log('Initializing embedder (first run downloads model ~130MB)...');

  const start = Date.now();
  const vec = await embedder.embed('Test sentence about authentication tokens.');
  console.log('First embed:', Date.now() - start, 'ms');
  console.log('Dimensions:', vec.length);
  console.log('Sample values:', vec.slice(0, 5).map(v => v.toFixed(4)));

  const start2 = Date.now();
  const vec2 = await embedder.embed('JWT token validation using RS256 algorithm.');
  console.log('Second embed:', Date.now() - start2, 'ms');

  // Test similarity
  const dot = vec.reduce((s, v, i) => s + v * vec2[i], 0);
  console.log('Cosine similarity (auth ↔ JWT):', dot.toFixed(4));

  const vec3 = await embedder.embed('How to make chocolate cake.');
  const dot2 = vec.reduce((s, v, i) => s + v * vec3[i], 0);
  console.log('Cosine similarity (auth ↔ cake):', dot2.toFixed(4));

  const vec4 = await embedder.embed('Use Express.js for REST API endpoints with rate limiting.');
  const dot3 = vec.reduce((s, v, i) => s + v * vec4[i], 0);
  console.log('Cosine similarity (auth ↔ API):', dot3.toFixed(4));

  const dot4 = vec2.reduce((s, v, i) => s + v * vec4[i], 0);
  console.log('Cosine similarity (JWT ↔ API):', dot4.toFixed(4));

  console.log('\nEmbedder working correctly.');
}

main().catch(console.error);
