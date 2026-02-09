// file: get-upload-domain.js
// 用法：直接修改下方常量后运行 node .\get-upload-domain.js

const fs = require("fs");
const crypto = require("crypto");

const ACCESS_TOKEN = "123.640e5b8e3e25f87b21832024eba42787.YHUs-QpgoFt2Qv5sSwHM1ReZld99NwVfoAjIezA.GyBP1w";
const LOCAL_FILE = "";
let UPLOAD_PATH = "";
const APP_ID = "122053376";

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

function buildBlockList(buffer) {
  const list = [];
  if (buffer.length <= FOUR_MB) {
    list.push(md5(buffer));
    return list;
  }
  for (let offset = 0; offset < buffer.length; offset += FOUR_MB) {
    const chunk = buffer.subarray(offset, Math.min(offset + FOUR_MB, buffer.length));
    list.push(md5(chunk));
  }
  return list;
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

  // 可选字段，但通常建议带上
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
  const text = await res.text();
  return text;
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
  const text = await res.text();
  return text;
}

async function main() {
  const buffer = fs.readFileSync(LOCAL_FILE);
  const size = buffer.length;
  const contentMd5 = md5(buffer);
  const sliceMd5 = md5(buffer.subarray(0, Math.min(SLICE, buffer.length)));
  const blockList = buildBlockList(buffer);

  const precreateText = await precreate({ size, blockList, contentMd5, sliceMd5 });
  console.log("precreate response:");
  console.log(precreateText);

  let uploadid;
  try {
    const json = JSON.parse(precreateText);
    uploadid = json.uploadid;
  } catch (_) {}

  if (!uploadid) {
    console.error("未能从 precreate 响应中解析到 uploadid");
    process.exit(1);
  }

  const locateText = await locateupload(uploadid);
  console.log("locateupload response:");
  console.log(locateText);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
