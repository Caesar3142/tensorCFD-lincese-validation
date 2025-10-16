import 'dotenv/config';
import { validateLicense } from '../services/licenseService.js';

async function run() {
  console.log('[testValidate] LICENSE_LIST_URL=', process.env.LICENSE_LIST_URL);
  try {
    // call validateLicense with fake credentials to force the loader to run
    const res = await validateLicense('alice@example.com', 'ABCDEF-123456');
    console.log('[testValidate] validateLicense result:', res);
  } catch (err) {
    console.error('[testValidate] Error calling validateLicense:', err && err.message ? err.message : err);
    process.exitCode = 2;
  }
}

run();
