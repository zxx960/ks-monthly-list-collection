// file: get-user-info.js
// 用法（PowerShell）:
// $env:ACCESS_TOKEN="你的token"; node get-user-info.js
// 可选：$env:VIP_VERSION="v2"

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VIP_VERSION = process.env.VIP_VERSION || "v2";

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
