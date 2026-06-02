#!/usr/bin/env node

const path = require("node:path");
const Module = require("node:module");

const mobileNodeModules = path.resolve(__dirname, "..", "node_modules");

process.env.NODE_PATH = process.env.NODE_PATH
  ? `${mobileNodeModules}${path.delimiter}${process.env.NODE_PATH}`
  : mobileNodeModules;

Module._initPaths();

require("expo/bin/cli");
