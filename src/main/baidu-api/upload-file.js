// file: upload-file.js
// 说明：Node 18+，使用内置 fetch
// 用法：直接修改下方常量后运行 node .\upload-file.js

const fs = require("fs");
const crypto = require("crypto");

const ACCESS_TOKEN = "123.640e5b8e3e25f87b21832024eba42787.YHUs-QpgoFt2Qv5sSwHM1ReZld99NwVfoAjIezA.GyBP1w";
const LOCAL_FILE = "";
let UPLOAD_PATH = "";
const APP_ID = "122053376";
const APP_KEY = "NQ5eywTG2zzKSCiz22cpoBj7ZQupLBzr";
const SECRET_KEY = "DrrX3hrIABYAY5E4aRA63UJXiaC4U8fO";
const SIGN_KEY = "CsNfPMcPHn#l--e*X@pSJy-*yPucKw*F@";
const UPLOAD_HOST = ""; // 可选，例如 "https://c3.pcs.baidu.com"

if (!ACCESS_TOKEN) {
  console.error("缺少 ACCESS_TOKEN 环境变量");
  process.exit(1);
}
if (!LOCAL_FILE) {
  console.error("缺少 LOCAL_FILE 环境变量");
  process.exit(1);
}
if (!UPLOAD_PATH) {
  const baseName = require("path").basename(LOCAL_FILE);
  UPLOAD_PATH = `/apps/zxx960/${baseName}`;
}

const FOUR_MB = 4 * 1024 * 1024;
const SLICE = 256 * 1024;

function md5(buf) {
  return crypto.createHash("md5").update(buf).digest("hex");
}

function splitToChunks(buffer) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += FOUR_MB) {
    chunks.push(buffer.subarray(offset, Math.min(offset + FOUR_MB, buffer.length)));
  }
  return chunks;
}

async function precreate({ size, blockList, contentMd5, sliceMd5 }) {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "precreate");
  url.searchParams.set("access_token", ACCESS_TOKEN);

  const body = new URLSearchParams();
  body.set("path", UPLOAD_PATH);
  body.set("size", String(size));
  body.set("isdir", "0");
  body.set("autoinit", "1");
  body.set("rtype", "1");
  body.set("block_list", JSON.stringify(blockList));
  body.set("content-md5", contentMd5);
  body.set("slice-md5", sliceMd5);

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "pan.baidu.com",
    },
    body,
  });
  return res.text();
}

async function locateupload(uploadid) {
  const url = new URL("https://d.pcs.baidu.com/rest/2.0/pcs/file");
  url.searchParams.set("method", "locateupload");
  url.searchParams.set("appid", APP_ID);
  url.searchParams.set("access_token", ACCESS_TOKEN);
  url.searchParams.set("path", UPLOAD_PATH);
  url.searchParams.set("uploadid", uploadid);
  url.searchParams.set("upload_version", "2.0");

  const res = await fetch(url.toString(), { method: "GET" });
  return res.text();
}

async function uploadPart({ host, uploadid, partseq, chunk }) {
  const url = new URL(`${host}/rest/2.0/pcs/superfile2`);
  url.searchParams.set("method", "upload");
  url.searchParams.set("access_token", ACCESS_TOKEN);
  url.searchParams.set("type", "tmpfile");
  url.searchParams.set("path", UPLOAD_PATH);
  url.searchParams.set("uploadid", uploadid);
  url.searchParams.set("partseq", String(partseq));

  const form = new FormData();
  const blob = new Blob([chunk]);
  form.append("file", blob, `part-${partseq}`);

  const res = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });
  return res.text();
}

async function createFile({ size, uploadid, blockList }) {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "create");
  url.searchParams.set("access_token", ACCESS_TOKEN);

  const body = new URLSearchParams();
  body.set("path", UPLOAD_PATH);
  body.set("size", String(size));
  body.set("isdir", "0");
  body.set("rtype", "1");
  body.set("uploadid", uploadid);
  body.set("block_list", JSON.stringify(blockList));

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "pan.baidu.com",
    },
    body,
  });
  return res.text();
}

async function main() {
  const buffer = fs.readFileSync(LOCAL_FILE);
  const size = buffer.length;
  const chunks = splitToChunks(buffer);
  const blockList = chunks.map(md5);
  const contentMd5 = md5(buffer);
  const sliceMd5 = md5(buffer.subarray(0, Math.min(SLICE, buffer.length)));

  const precreateText = await precreate({ size, blockList, contentMd5, sliceMd5 });
  console.log("precreate response:");
  console.log(precreateText);

  let uploadid;
  let needParts = null;
  try {
    const json = JSON.parse(precreateText);
    uploadid = json.uploadid;
    if (Array.isArray(json.block_list)) {
      needParts = json.block_list;
    }
  } catch (_) {}

  if (!uploadid) {
    console.error("未能从 precreate 响应中解析到 uploadid");
    process.exit(1);
  }

  let host = UPLOAD_HOST;
  if (!host) {
    const locateText = await locateupload(uploadid);
    console.log("locateupload response:");
    console.log(locateText);
    try {
      const j = JSON.parse(locateText);
      if (Array.isArray(j.servers) && j.servers.length > 0) {
        host = j.servers.find((s) => s.server.startsWith("https://"))?.server || j.servers[0].server;
      } else if (Array.isArray(j.quic_servers) && j.quic_servers.length > 0) {
        host = j.quic_servers[0].server;
      } else if (j.host) {
        host = `https://${j.host}`;
      }
    } catch (_) {}
  }

  if (!host) {
    console.error("未能获取上传域名，请设置 UPLOAD_HOST 环境变量");
    process.exit(1);
  }

  const parts = Array.isArray(needParts) && needParts.length > 0
    ? needParts
    : chunks.map((_, i) => i);

  for (const partseq of parts) {
    const chunk = chunks[partseq];
    if (!chunk) {
      console.error(`缺少分片 partseq=${partseq}`);
      process.exit(1);
    }
    const uploadText = await uploadPart({ host, uploadid, partseq, chunk });
    console.log(`upload part ${partseq} response:`);
    console.log(uploadText);
  }

  const createText = await createFile({ size, uploadid, blockList });
  console.log("create response:");
  console.log(createText);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
