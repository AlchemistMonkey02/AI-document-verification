const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, 'ai-document-verifier', '.env');
const content = `OPENAI_API_KEY=PLACEHOLDER_KEY_DO_NOT_COMMIT
LOCAL_LLM_URL=http://localhost:11434/api/generate
LOCAL_LLM_MODEL=llama3`;

fs.writeFileSync(envPath, content, { encoding: 'utf8' });
console.log(`Rewrote .env to ${envPath} with UTF-8 encoding.`);
