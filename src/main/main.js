const {app, BrowserWindow, ipcMain, session} = require('electron');
const {join, extname} = require('path');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const {Readable} = require('stream');
const {pipeline} = require('stream/promises');

const BAIDU_ACCESS_TOKEN = '123.640e5b8e3e25f87b21832024eba42787.YHUs-QpgoFt2Qv5sSwHM1ReZld99NwVfoAjIezA.GyBP1w';
const BAIDU_APP_ID = '122053376';
const BAIDU_UPLOAD_DIR = '/apps/zxx960';
const BAIDU_UPLOAD_HOST = '';
const BAIDU_SHARE_PERIOD = '7';
const FOUR_MB = 4 * 1024 * 1024;
const SLICE = 256 * 1024;

function normalizeAccessToken(accessToken) {
  return (accessToken || BAIDU_ACCESS_TOKEN || '').toString().trim();
}

function baiduErrnoMessage(errno) {
  if (errno === -6) return '身份验证失败：access_token 可能已失效，请重新获取 token 后再上传';
  if (errno === 31045) return 'access_token 验证未通过：请检查 access_token 是否过期、授权时是否勾选网盘权限等，重新获取 token 后再上传';
  return `百度接口错误 errno=${errno}`;
}

function makeBaiduError(errno, api, data) {
  const err = new Error(`${baiduErrnoMessage(errno)} (${api})`);
  err.baiduErrno = errno;
  err.baiduApi = api;
  err.baiduData = data;
  return err;
}

function assertBaiduOk(data, api) {
  const errno = Number.isFinite(data?.errno) ? data.errno : (Number.isFinite(data?.error_code) ? data.error_code : 0);
  if (errno && errno !== 0) {
    throw makeBaiduError(errno, api, data);
  }
}

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function splitToChunks(buffer) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += FOUR_MB) {
    chunks.push(buffer.subarray(offset, Math.min(offset + FOUR_MB, buffer.length)));
  }
  return chunks;
}

function randomSharePwd() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function safeName(input) {
  const normalized = (input || 'video').toString().normalize('NFKC');
  const cleaned = normalized
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[^\p{L}\p{N}._\- ]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[ ._\-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return cleaned || 'video';
}

function isVideoUrlRow(row) {
  if (!row || !row.videoUrl) return false;
  return row.videoUrl !== '已删除' && row.videoUrl !== '无链接';
}

function fileExtFromUrl(videoUrl) {
  try {
    const pathname = new URL(videoUrl).pathname || '';
    return extname(pathname) || '.mp4';
  } catch {
    return '.mp4';
  }
}

async function downloadVideoToFile(videoUrl, filePath) {
  const res = await fetch(videoUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://jigou.kuaishou.com/'
    }
  });

  if (!res.ok || !res.body) {
    throw new Error(`下载失败，HTTP ${res.status}`);
  }

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(filePath));
}

async function baiduPrecreate({uploadPath, size, blockList, contentMd5, sliceMd5, accessToken}) {
  const token = normalizeAccessToken(accessToken);
  const url = new URL('https://pan.baidu.com/rest/2.0/xpan/file');
  url.searchParams.set('method', 'precreate');
  url.searchParams.set('access_token', token);

  const body = new URLSearchParams();
  body.set('path', uploadPath);
  body.set('size', String(size));
  body.set('isdir', '0');
  body.set('autoinit', '1');
  body.set('rtype', '1');
  body.set('block_list', JSON.stringify(blockList));
  body.set('content-md5', contentMd5);
  body.set('slice-md5', sliceMd5);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'pan.baidu.com'
    },
    body
  });

  const data = await res.json();
  assertBaiduOk(data, 'precreate');
  return data;
}

async function baiduLocateUpload({uploadPath, uploadid, accessToken}) {
  const token = normalizeAccessToken(accessToken);
  const url = new URL('https://d.pcs.baidu.com/rest/2.0/pcs/file');
  url.searchParams.set('method', 'locateupload');
  url.searchParams.set('appid', BAIDU_APP_ID);
  url.searchParams.set('access_token', token);
  url.searchParams.set('path', uploadPath);
  url.searchParams.set('uploadid', uploadid);
  url.searchParams.set('upload_version', '2.0');

  const res = await fetch(url.toString(), {method: 'GET'});
  const data = await res.json();
  assertBaiduOk(data, 'locateupload');
  return data;
}

async function baiduUploadPart({host, uploadPath, uploadid, partseq, chunk, accessToken}) {
  const token = normalizeAccessToken(accessToken);
  const url = new URL(`${host}/rest/2.0/pcs/superfile2`);
  url.searchParams.set('method', 'upload');
  url.searchParams.set('access_token', token);
  url.searchParams.set('type', 'tmpfile');
  url.searchParams.set('path', uploadPath);
  url.searchParams.set('uploadid', uploadid);
  url.searchParams.set('partseq', String(partseq));

  const form = new FormData();
  form.append('file', new Blob([chunk]), `part-${partseq}`);

  const res = await fetch(url.toString(), {
    method: 'POST',
    body: form
  });

  const data = await res.json();
  assertBaiduOk(data, `uploadpart:${partseq}`);
  return data;
}

async function baiduCreateFile({uploadPath, size, uploadid, blockList, accessToken}) {
  const token = normalizeAccessToken(accessToken);
  const url = new URL('https://pan.baidu.com/rest/2.0/xpan/file');
  url.searchParams.set('method', 'create');
  url.searchParams.set('access_token', token);

  const body = new URLSearchParams();
  body.set('path', uploadPath);
  body.set('size', String(size));
  body.set('isdir', '0');
  body.set('rtype', '1');
  body.set('uploadid', uploadid);
  body.set('block_list', JSON.stringify(blockList));

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'pan.baidu.com'
    },
    body
  });

  const data = await res.json();
  assertBaiduOk(data, 'create');
  return data;
}

async function createBaiduShareLink(fsid, accessToken) {
  const token = normalizeAccessToken(accessToken);
  const pwd = randomSharePwd();
  const url = new URL('https://pan.baidu.com/apaas/1.0/share/set');
  url.searchParams.set('product', 'netdisk');
  url.searchParams.set('appid', BAIDU_APP_ID);
  url.searchParams.set('access_token', token);

  const form = new FormData();
  form.append('fsid_list', JSON.stringify([String(fsid)]));
  form.append('period', BAIDU_SHARE_PERIOD);
  form.append('pwd', pwd);

  const res = await fetch(url.toString(), {
    method: 'POST',
    body: form
  });
  const data = await res.json();

  assertBaiduOk(data, 'share/set');

  const payload = data?.data || data;
  const shortCode = payload?.short_url || payload?.shorturl || payload?.surl || '';
  let link = payload?.link || payload?.shortlink || '';

  if (!link && shortCode) {
    link = `https://pan.baidu.com/netdisk/share?surl=${shortCode}`;
  }

  if (typeof link === 'string' && link && !/^https?:\/\//i.test(link)) {
    const normalized = link.replace(/^\/?s\//, '');
    link = `https://pan.baidu.com/s/${normalized}`;
  }
  if (link && !link.includes('pwd=')) {
    link += `${link.includes('?') ? '&' : '?'}pwd=${pwd}`;
  }

  if (!link) {
    throw new Error(`创建分享链接返回空链接: ${JSON.stringify(data)}`);
  }

  return link;
}

async function uploadFileToBaidu(localFile, uploadPath, accessToken) {
  const buffer = await fsp.readFile(localFile);
  const size = buffer.length;
  const chunks = splitToChunks(buffer);
  const blockList = chunks.map(md5);
  const contentMd5 = md5(buffer);
  const sliceMd5 = md5(buffer.subarray(0, Math.min(SLICE, buffer.length)));

  const precreateData = await baiduPrecreate({uploadPath, size, blockList, contentMd5, sliceMd5, accessToken});
  const uploadid = precreateData?.uploadid;
  const needParts = Array.isArray(precreateData?.block_list) ? precreateData.block_list : null;

  if (!uploadid) {
    throw new Error(`precreate 未返回 uploadid: ${JSON.stringify(precreateData)}`);
  }

  let host = BAIDU_UPLOAD_HOST;
  if (!host) {
    const locateData = await baiduLocateUpload({uploadPath, uploadid, accessToken});
    if (Array.isArray(locateData?.servers) && locateData.servers.length > 0) {
      host = locateData.servers.find((s) => s?.server?.startsWith('https://'))?.server || locateData.servers[0].server;
    } else if (Array.isArray(locateData?.quic_servers) && locateData.quic_servers.length > 0) {
      host = locateData.quic_servers[0].server;
    } else if (locateData?.host) {
      host = `https://${locateData.host}`;
    }
  }

  if (!host) {
    throw new Error('未获取到上传域名');
  }

  const parts = Array.isArray(needParts) && needParts.length > 0 ? needParts : chunks.map((_, i) => i);
  for (const partseq of parts) {
    const chunk = chunks[partseq];
    if (!chunk) throw new Error(`分片不存在: ${partseq}`);
    await baiduUploadPart({host, uploadPath, uploadid, partseq, chunk, accessToken});
  }

  const createResp = await baiduCreateFile({uploadPath, size, uploadid, blockList, accessToken});

  const fsid = createResp?.fs_id || createResp?.info?.fs_id || createResp?.info?.[0]?.fs_id;
  if (!fsid) {
    throw new Error(`创建文件未返回 fs_id: ${JSON.stringify(createResp)}`);
  }
  return {fsid};
}

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1500,
    height: 1000,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  if (process.env.NODE_ENV === 'development') {
    const rendererPort = process.argv[2];
    mainWindow.loadURL(`http://localhost:${rendererPort}`);
  }
  else {
    mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ['default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:; script-src * \'unsafe-inline\' \'unsafe-eval\'; connect-src * \'unsafe-inline\'; img-src * data: blob: \'unsafe-inline\'; frame-src *; style-src * \'unsafe-inline\';']
      }
    })
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
});

ipcMain.on('message', (event, message) => {
  console.log(message);
})

ipcMain.handle('upload-videos-to-baidu', async (_event, payload) => {
  const rows = Array.isArray(payload) ? payload : payload?.rows;
  const accessToken = normalizeAccessToken(Array.isArray(payload) ? '' : payload?.accessToken);
  if (!accessToken) {
    throw new Error('参数错误: 缺少 accessToken');
  }
  if (!Array.isArray(rows)) {
    throw new Error('参数错误: rows 必须是数组');
  }

  const tempDir = path.join(app.getPath('temp'), 'ks-monthly-list-collection');
  await fsp.mkdir(tempDir, {recursive: true});

  const resultRows = rows.map((row) => ({...row, shareUrl: row?.shareUrl || ''}));
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  const emitProgress = (index, extra) => {
    try {
      _event?.sender?.send('upload-videos-to-baidu-progress', {
        index,
        row: resultRows[index],
        summary: {
          total: resultRows.length,
          success: successCount,
          failed: failCount,
          skipped: skipCount
        },
        ...(extra || {})
      });
    } catch {
      // ignore
    }
  };

  let globalTipSent = false;

  for (let i = 0; i < resultRows.length; i++) {
    const row = resultRows[i];
    if (!isVideoUrlRow(row)) {
      resultRows[i] = {...row, shareUrl: row.videoUrl === '已删除' ? '已删除' : '无链接'};
      skipCount++;
      emitProgress(i);
      continue;
    }

    const baseName = safeName(row.title || `video-${i + 1}`);
    const ext = fileExtFromUrl(row.videoUrl);
    const localFile = path.join(tempDir, `${Date.now()}-${i + 1}-${baseName}${ext}`);
    const uploadPath = `${BAIDU_UPLOAD_DIR}/${path.basename(localFile)}`;

    let shouldStop = false;
    try {
      await downloadVideoToFile(row.videoUrl, localFile);
      const {fsid} = await uploadFileToBaidu(localFile, uploadPath, accessToken);
      const shareUrl = await createBaiduShareLink(fsid, accessToken);
      resultRows[i] = {...row, shareUrl};
      successCount++;
      emitProgress(i);
    } catch (err) {
      console.error(`上传百度网盘失败 index=${i}`, err);
      resultRows[i] = {...row, shareUrl: '上传失败'};
      failCount++;
      const errno = err?.baiduErrno;
      if (!globalTipSent && (errno === -6 || errno === 31045)) {
        globalTipSent = true;
        shouldStop = true;
        emitProgress(i, {globalErrno: errno, globalMessage: baiduErrnoMessage(errno)});
      } else {
        emitProgress(i);
      }
    } finally {
      await fsp.unlink(localFile).catch(() => {});
    }

    if (shouldStop) {
      break;
    }
  }

  return {
    rows: resultRows,
    summary: {
      total: resultRows.length,
      success: successCount,
      failed: failCount,
      skipped: skipCount
    }
  };
});
