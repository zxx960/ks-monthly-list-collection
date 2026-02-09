// file: get-user-info.js
// 用法：直接修改下方常量后运行 node get-user-info.js

const ACCESS_TOKEN = "123.640e5b8e3e25f87b21832024eba42787.YHUs-QpgoFt2Qv5sSwHM1ReZld99NwVfoAjIezA.GyBP1w";
const VIP_VERSION = "v2";

if (!ACCESS_TOKEN) {
  console.error("缺少 ACCESS_TOKEN 环境变量");
  process.exit(1);
}

const url = new URL("https://pan.baidu.com/rest/2.0/xpan/nas");
url.searchParams.set("method", "uinfo");
url.searchParams.set("access_token", ACCESS_TOKEN);
url.searchParams.set("vip_version", VIP_VERSION);

async function main() {
  const res = await fetch(url.toString(), { method: "GET" });
  const text = await res.text();
  console.log(text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
