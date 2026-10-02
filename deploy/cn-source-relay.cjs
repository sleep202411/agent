#!/usr/bin/env node
// Relays the CN build source archive through the private build-artifacts bucket.
//
//   node deploy/cn-source-relay.cjs put <file> <key>   prints a 15-minute presigned GET URL
//                                                     for the bucket's in-region endpoint
//   node deploy/cn-source-relay.cjs delete <key>
//
// The upload goes through build-relay.fizzspace.cn, the bucket's accelerated custom
// domain: mainland buckets refuse their default public endpoints, and a direct scp from
// outside China crawls. The bucket is private, blocks public access, has no CDN, and
// expires src/ after a day. Credentials come from the aliyun CLI profile
// (ALIYUN_PROFILE, default "default") and are read in process only.
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const OSS = require("ali-oss");

const BUCKET = "fizzdragon-cn-build-artifacts";
const UPLOAD_DOMAIN = "https://build-relay.fizzspace.cn";
const KEY_PATTERN = /^src\/[0-9a-f]{40}-[0-9a-f]{16}\.tar\.gz$/;

const profileName = process.env.ALIYUN_PROFILE || "default";
const profile = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), ".aliyun", "config.json"), "utf8")
).profiles.find((candidate) => candidate.name === profileName);
if (!profile?.access_key_id || !profile?.access_key_secret) {
  throw new Error(`aliyun CLI profile "${profileName}" has no access key`);
}

const base = {
  bucket: BUCKET,
  region: "oss-cn-hangzhou",
  accessKeyId: profile.access_key_id,
  accessKeySecret: profile.access_key_secret,
  secure: true,
  timeout: 1_800_000,
};
const uploader = new OSS({ ...base, endpoint: UPLOAD_DOMAIN, cname: true });
const inRegion = new OSS({ ...base, internal: true });

function requireKey(key) {
  if (!KEY_PATTERN.test(key ?? "")) throw new Error(`refusing unexpected relay key: ${key}`);
  return key;
}

async function main() {
  const [command, first, second] = process.argv.slice(2);
  if (command === "put") {
    const key = requireKey(second);
    await uploader.multipartUpload(key, first, {
      parallel: 4,
      partSize: 8 * 1024 * 1024,
      headers: { "Cache-Control": "no-store" },
    });
    process.stdout.write(`${inRegion.signatureUrl(key, { expires: 900, method: "GET" })}\n`);
    return;
  }
  if (command === "delete") {
    await uploader.delete(requireKey(first));
    return;
  }
  throw new Error("usage: cn-source-relay.cjs put <file> <key> | delete <key>");
}

main().catch((error) => {
  process.stderr.write(
    `cn-source-relay: ${error.status ?? ""} ${error.code ?? ""} ${error.message}\n`
  );
  process.exit(1);
});
