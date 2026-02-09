// file: create-share-link.js
// 说明：Node 18+，使用内置 fetch/FormData
// 用法：直接修改下方常量后运行 node .\create-share-link.js

const ACCESS_TOKEN = "123.640e5b8e3e25f87b21832024eba42787.YHUs-QpgoFt2Qv5sSwHM1ReZld99NwVfoAjIezA.GyBP1w";
const FSID_LIST = '["1234567","7654321"]';
const PERIOD = "7";
const PWD = "12zx";
const APP_ID = "122053376";
const REMARK = "";

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
