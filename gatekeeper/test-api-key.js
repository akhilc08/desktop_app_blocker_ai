#!/usr/bin/env node
/**
 * Simple API key test — validates @google/genai connectivity
 * Usage: node test-api-key.js [API_KEY]
 *        or: GEMINI_API_KEY=your_key node test-api-key.js
 */

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
  console.error('❌ No API key provided.');
  console.error('Usage:');
  console.error('  node test-api-key.js YOUR_API_KEY');
  console.error('  or set GEMINI_API_KEY environment variable');
  process.exit(1);
}

(async () => {
  try {
    console.log('🔍 Testing API key...\n');

    // Initialize GoogleGenAI client, passing apiKey explicitly
    const { GoogleGenAI } = require('@google/genai');
    const client = new GoogleGenAI({ apiKey });
    console.log('✅ GoogleGenAI client initialized\n');

    // Test: generateContent
    console.log('✍️  Attempting text generation with gemini-3-flash-preview...');
    try {
      const response = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: 'Say "test successful" in one word.',
      });
      console.log('✅ Generation succeeded!');
      console.log('Response:', response && response.text ? response.text : JSON.stringify(response, null, 2));
    } catch (e) {
      console.log(`❌ Generation failed: ${e.message}`);
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✅ API key test complete!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
