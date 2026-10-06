// Use the same real-source transforms as unit/integration tests.
const { jest: config } = require('../package.json');
module.exports = {
  ...config,
  rootDir: '../src',
  roots: ['<rootDir>/../test'],
  testRegex: '\\.e2e-spec\\.ts$',
};
