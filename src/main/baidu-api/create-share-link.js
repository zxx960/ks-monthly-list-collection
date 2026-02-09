// file: create-share-link.js
// 说明：Node 18+，使用内置 fetch/FormData
// 用法（PowerShell）:
// $env:ACCESS_TOKEN="你的token"
// $env:FSID_LIST='["1234567","7654321"]'  // 必填，json 字符串数组
// $env:PERIOD="7"  // 必填，分享天数
// $env:PWD="12zx"  // 必填，4位数字+小写字母
// node .\create-share-link.js
// 可选：$env:APP_ID="250529"  默认 250529
// 可选：$env:REMARK="备注"

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const FSID_LIST = process.env.FSID_LIST;
const PERIOD = process.env.PERIOD;
const PWD = process.env.PWD;
const APP_ID = process.env.APP_ID || "250529";
const REMARK = process.env.REMARK;

if (!ACCESS_TOKEN) {
  console.error("缺少 ACCESS_TOKEN 环境变量");
  process.exit(1);
}
if (!FSID_LIST) {
  console.error("缺少 FSID_LIST 环境变量（json 字符串数组）");
  process.exit(1);
}
if (!PERIOD) {
  console.error("缺少 PERIOD 环境变量");
  process.exit(1);
}
if (!PWD) {
  console.error("缺少 PWD 环境变量");
  process.exit(1);
}

const url = new URL("https://pan.baidu.com/apaas/1.0/share/set");
url.searchParams.set("product", "netdisk");
url.searchParams.set("appid", APP_ID);
url.searchParams.set("access_token", ACCESS_TOKEN);

async function main() {
  const form = new FormData();
  form.append("fsid_list", FSID_LIST);
  form.append("period", String(PERIOD));
  form.append("pwd", PWD);
  if (REMARK) form.append("remark", REMARK);

  const res = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });
  const text = await res.text();
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
