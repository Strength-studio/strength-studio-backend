const { resolve } = require('node:path');

// Next.js forwards Node flags to its dev server, where --env-file is rejected.
process.loadEnvFile(resolve(__dirname, '../../.env'));
require('next/dist/bin/next');
