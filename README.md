# 鱼粉快手月榜单采集

一个基于 **Electron + Vue 3** 的桌面工具，用于在快手机构后台采集月榜单数据，并支持：

- 数据清洗（调用火山大模型）
- 上传视频到百度网盘并生成分享链接
- 导出 Excel

## 功能概览

1. **榜单采集**
   - 按页采集（可配置页数）
   - 翻页逻辑：点击“下一页”后固定等待 2 秒继续采集
2. **标题处理**
   - 自动去除 `@` / `#` 话题及其后缀内容
   - 清理后为空时自动填充“无标题”
3. **数据清洗**
   - 使用火山 API Key 调用模型判断并清洗带货数据
4. **百度网盘上传**
   - 支持填写并自动保存 `ACCESS_TOKEN`
   - 上传后回填分享链接与提取码
   - 针对 token 失效场景（如 `errno=-6`、`errno=31045`）提供提示并中止
5. **Excel 导出**
   - 导出字段包含：视频名称、发布时间、播放量、点赞量、视频链接、分享链接、提取码

## 技术栈

- Electron
- Vue 3
- Vite
- Electron Builder
- xlsx

## 安装与启动

### 1）安装依赖

```bash
npm install
```

### 2）开发模式运行

```bash
npm run dev
```

## 打包命令

```bash
npm run build       # 默认打包
npm run build:win   # 打包 Windows
npm run build:mac   # 打包 macOS
npm run build:linux # 打包 Linux
```

打包产物可在 `dist/` 目录查看。

## 使用流程

1. 打开应用并登录快手机构后台页面。
2. 填写：
   - 火山 API Key（用于数据清洗）
   - 百度 ACCESS_TOKEN（用于百度网盘上传）
3. 设置采集页数，点击“采集数据”。
4. 按需点击“数据清洗”。
5. 点击“上传百度网盘”生成分享链接与提取码。
6. 点击“导出Excel”下载结果表。

## 项目结构

```bash
scripts/             # 开发与构建脚本
src/
  main/              # Electron 主进程
  renderer/          # Vue 渲染进程
```

## 注意事项

1. `ACCESS_TOKEN` 需要具备百度网盘相关权限。
2. 若出现 token 相关报错，请检查：
   - token 是否过期
   - 授权时是否勾选网盘权限
3. 采集与上传过程中请保持网络稳定。

## 百度 ACCESS_TOKEN 获取方式

1. 打开以下授权地址（单行）：

```text
https://openapi.baidu.com/oauth/2.0/authorize?response_type=token&client_id=NQ5eywTG2zzKSCiz22cpoBj7ZQupLBzr&redirect_uri=oob&scope=basic,netdisk
```

2. 登录百度账号并确认授权。
3. 页面会返回包含 `access_token` 的结果，复制后填入本工具的“百度 ACCESS_TOKEN”输入框。

> 提示：`access_token` 有有效期，过期后需要重新授权获取。
