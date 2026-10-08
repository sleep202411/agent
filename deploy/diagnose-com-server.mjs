#!/usr/bin/env node
// Retired with the Azure .com deployment; never query the old cluster.
console.error(
  "The Azure .com diagnostic has retired. Use deploy/deploy-com.sh --check with the Singapore kubeconfig instead."
);
process.exitCode = 1;
