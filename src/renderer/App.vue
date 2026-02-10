<script setup lang="ts">
import {ref} from 'vue';
import * as XLSX from 'xlsx';

type RowItem = {
  title: string;
  publishTime: string;
  playCount: string;
  likeCount: string;
  videoUrl: string;
  shareUrl: string;
};

window.electronAPI.sendMessage('App loaded with webview layout!');

const webviewRef = ref<any>(null);
const isCollecting = ref(false);
const isCleaning = ref(false);
const isUploadingToBaidu = ref(false);
const pageCount = ref<number>(1);
const cleaningProgress = ref<{ total: number; done: number }>({total: 0, done: 0});
const modalVisible = ref(false);
const modalMessage = ref('');
const collectedRows = ref<RowItem[]>([]);

type UploadProgressPayload = {
  index: number;
  row: RowItem;
  summary?: {total: number; success: number; failed: number; skipped: number};
};

const showModal = (message: string) => {
  modalMessage.value = message;
  modalVisible.value = true;
};

const closeModal = () => {
  modalVisible.value = false;
};

const arkApiKey = ref<string>((localStorage.getItem('ARK_API_KEY') || '').trim());

const saveArkApiKey = () => {
  const key = (arkApiKey.value || '').trim();
  if (key) {
    localStorage.setItem('ARK_API_KEY', key);
  } else {
    localStorage.removeItem('ARK_API_KEY');
  }
};

const clearArkApiKey = () => {
  arkApiKey.value = '';
  localStorage.removeItem('ARK_API_KEY');
};

const extractJsonFromText = (text: string) => {
  const m = (text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
};

const isShoppableByAI = async (apiKey: string, title: string) => {
  const prompt = `你是一个短文本分类器。判断下面这个“视频标题”是否属于带货/电商推广内容。\n\n视频标题：${title}\n\n判定为带货的常见特征：\n- 出现商品/品牌/型号/规格等明显产品信息\n- 出现购买引导：下单、购买、链接、店铺、橱窗、购物车、直播间、领券、到手价、包邮、折扣等\n\n请只返回JSON，不要返回任何多余文字，格式：{"isShopping":true/false,"reason":"一句话理由"}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const resp = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'doubao-seed-1-6-flash-250828',
        messages: [{role: 'user', content: prompt}],
        thinking: {type: 'disabled'},
        temperature: 0.2,
        max_tokens: 1024
      }),
      signal: controller.signal
    });

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const json = extractJsonFromText(content);
    return {
      isShopping: !!json?.isShopping,
      reason: (json?.reason ?? '').toString()
    };
  } finally {
    clearTimeout(timer);
  }
};

const handleCleanButtonClick = async () => {
  if (isCollecting.value || isCleaning.value) return;
  if (!collectedRows.value || collectedRows.value.length === 0) return;

  const apiKey = (arkApiKey.value || '').trim();
  if (!apiKey) {
    window.electronAPI.sendMessage('请先填写并保存 Ark API Key');
    return;
  }

  try {
    isCleaning.value = true;
    cleaningProgress.value = {total: collectedRows.value.length, done: 0};

    const toRemove = new Set<number>();
    let failedCount = 0;

    for (let i = 0; i < collectedRows.value.length; i++) {
      const row = collectedRows.value[i];
      const title = (row?.title ?? '').toString();

      // 已删除的视频直接标记删除，不调用大模型
      if (row.videoUrl === '已删除') {
        toRemove.add(i);
      } else {
        try {
          const res = await isShoppableByAI(apiKey, title);
          if (res.isShopping) toRemove.add(i);
        } catch (e) {
          failedCount++;
        }
      }

      cleaningProgress.value = {total: cleaningProgress.value.total, done: i + 1};
      await new Promise((r) => setTimeout(r, 200));
    }

    const before = collectedRows.value.length;
    const deletedCount = Array.from(collectedRows.value).filter(r => r.videoUrl === '已删除').length;
    collectedRows.value = collectedRows.value.filter((_, idx) => !toRemove.has(idx));
    const after = collectedRows.value.length;
    const shoppableCount = (before - after) - deletedCount;
    showModal(`数据清洗完成：删除 ${deletedCount} 条已删除数据，${shoppableCount} 条带货数据，剩余 ${after} 条${failedCount ? `，失败 ${failedCount} 条（已跳过）` : ''}`);
  } catch (e) {
    console.error('数据清洗失败', e);
    window.electronAPI.sendMessage('数据清洗失败');
  } finally {
    isCleaning.value = false;
    cleaningProgress.value = {total: 0, done: 0};
  }
};

const handleButtonClick = async () => {
  const webview = webviewRef.value;
  if (!webview) {
    console.warn('webview not ready');
    return;
  }

  try {
    isCollecting.value = true;
    const targetPages = Math.max(1, Math.floor(Number(pageCount.value) || 1));
    pageCount.value = targetPages;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const collectBaseRowsOnCurrentPage = async () => {
      const baseRows = await webview.executeJavaScript(
        `(async () => {
          const normalize = (s) => (s ?? '').toString().replace(/\\s+/g, ' ').trim();

          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

          const waitForRows = async () => {
            const timeoutMs = 15000;
            const intervalMs = 300;
            const start = Date.now();

            while (Date.now() - start < timeoutMs) {
              const list = Array.from(document.querySelectorAll('tbody tr.ks-table__row'));
              if (list.length > 0) return list;
              await sleep(intervalMs);
            }
            return [];
          };

          const trList = await waitForRows();
          return trList.map((tr) => {
            const tds = Array.from(tr.querySelectorAll('td'));

            const title = normalize(tr.querySelector('.info__title__text')?.textContent);
            const timeItems = Array.from(tr.querySelectorAll('.info__base__time__item'));
            const publishTime = normalize(timeItems[0]?.textContent);

            const playCount = normalize(tds[1]?.querySelector('.cell')?.textContent);
            const likeCount = normalize(tds[2]?.querySelector('.cell')?.textContent);

            return {title, publishTime, playCount, likeCount};
          }).filter(r => r.title || r.publishTime || r.playCount || r.likeCount);
        })()`,
        true
      );
      return Array.isArray(baseRows) ? baseRows : [];
    };

    const collectVideoUrlOnCurrentPageByIndex = async (idx: number) => {
      const videoUrl = await webview.executeJavaScript(
        `(async () => {
          const idx = ${idx};

          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

          const trList = Array.from(document.querySelectorAll('tbody tr.ks-table__row'));
          const rowElement = trList[idx];
          if (!rowElement) return '';

          const deletedTip = rowElement.querySelector('.info__title__tip');
          if (deletedTip && (deletedTip.textContent || '').includes('作品已删除')) {
            return '已删除';
          }

          const coverElement = rowElement.querySelector('.cover');
          if (!coverElement) return '';

          const emptyCover = coverElement.querySelector('.cover__img--empty');
          if (emptyCover) {
            return '已删除';
          }

          const playIcon = coverElement.querySelector('.cover__icon');
          if (playIcon) {
            playIcon.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);
            playIcon.click();
          } else {
            coverElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);
            coverElement.click();
          }

          await sleep(2000);

          const videoElement = document.querySelector('.video-player video');
          const url = (videoElement && (videoElement.src || videoElement.currentSrc)) ? (videoElement.src || videoElement.currentSrc) : '';

          await sleep(2000);
          const escEvent = new KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true
          });
          document.dispatchEvent(escEvent);

          return url;
        })()`,
        true
      );
      return videoUrl;
    };

    const clickNextPageAndWait = async (prevFirstTitle: string) => {
      const ok = await webview.executeJavaScript(
        `(async () => {
          const prev = ${JSON.stringify(prevFirstTitle || '')};
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

          const btn = document.querySelector('button.btn-next');
          if (!btn) return false;
          btn.click();

          const timeoutMs = 15000;
          const intervalMs = 300;
          const start = Date.now();

          while (Date.now() - start < timeoutMs) {
            const first = document.querySelector('tbody tr.ks-table__row .info__title__text');
            const title = (first && first.textContent) ? first.textContent.replace(/\\s+/g, ' ').trim() : '';
            if (title && title !== prev) return true;
            await sleep(intervalMs);
          }
          return false;
        })()`,
        true
      );
      return !!ok;
    };

    collectedRows.value = [];

    let prevFirstTitle = '';
    for (let page = 0; page < targetPages; page++) {
      const baseRowsOnPage = await collectBaseRowsOnCurrentPage();
      const startIndex = collectedRows.value.length;

      if (!prevFirstTitle) {
        prevFirstTitle = (baseRowsOnPage[0]?.title ?? '').toString();
      }

      collectedRows.value.push(...baseRowsOnPage.map((r) => ({...r, videoUrl: '', shareUrl: ''})));
      window.electronAPI.sendMessage(`第 ${page + 1} 页采集到 ${baseRowsOnPage.length} 条数据，开始采集视频链接...`);

      for (let i = 0; i < baseRowsOnPage.length; i++) {
        const videoUrl = await collectVideoUrlOnCurrentPageByIndex(i);
        const normalizedVideoUrl = videoUrl === '已删除' ? '已删除' : (videoUrl ? videoUrl : '无链接');
        const targetIndex = startIndex + i;
        if (collectedRows.value[targetIndex]) {
          collectedRows.value[targetIndex] = {...collectedRows.value[targetIndex], videoUrl: normalizedVideoUrl};
        }

        if (i < baseRowsOnPage.length - 1) {
          await sleep(2000);
        }
      }

      prevFirstTitle = (baseRowsOnPage[0]?.title ?? '').toString();

      if (page < targetPages - 1) {
        const nextOk = await clickNextPageAndWait(prevFirstTitle);
        if (!nextOk) {
          window.electronAPI.sendMessage('翻页失败或超时，停止后续采集');
          break;
        }
        await sleep(500);
      }
    }
  } catch (e) {
    console.error('采集失败', e);
    window.electronAPI.sendMessage('采集失败');
  } finally {
    isCollecting.value = false;
  }
};

const handleUploadToBaiduClick = async () => {
  if (isCollecting.value || isCleaning.value || isUploadingToBaidu.value) return;
  if (!collectedRows.value.length) return;

  let unsubscribeProgress: null | (() => void) = null;
  try {
    isUploadingToBaidu.value = true;

    unsubscribeProgress = window.electronAPI.onUploadVideosToBaiduProgress((payload: UploadProgressPayload) => {
      const index = Number(payload?.index);
      if (!Number.isFinite(index) || index < 0) return;
      if (!payload?.row) return;
      if (!collectedRows.value[index]) return;
      collectedRows.value[index] = {...collectedRows.value[index], ...payload.row};
    });

    const payload = collectedRows.value.map((row) => ({
      title: row.title,
      publishTime: row.publishTime,
      playCount: row.playCount,
      likeCount: row.likeCount,
      videoUrl: row.videoUrl,
      shareUrl: row.shareUrl
    }));
    const result = await window.electronAPI.uploadVideosToBaidu(payload);
    if (result?.rows && Array.isArray(result.rows)) {
      collectedRows.value = result.rows;
    }

    const summary = result?.summary || {success: 0, failed: 0, skipped: 0};
    showModal(`上传完成：成功 ${summary.success} 条，失败 ${summary.failed} 条，跳过 ${summary.skipped} 条`);
  } catch (e) {
    console.error('上传百度网盘失败', e);
    showModal('上传百度网盘失败，请查看控制台日志');
  } finally {
    if (unsubscribeProgress) {
      try {
        unsubscribeProgress();
      } catch {
        // ignore
      }
    }
    isUploadingToBaidu.value = false;
  }
};

const handleExportExcelClick = () => {
  if (!collectedRows.value || collectedRows.value.length === 0) return;

  const rows = collectedRows.value.map((r) => ({
    视频名称: (r?.title ?? '').toString(),
    发布时间: (r?.publishTime ?? '').toString(),
    播放量: (r?.playCount ?? '').toString(),
    点赞量: (r?.likeCount ?? '').toString(),
    视频链接: (r?.videoUrl ?? '').toString(),
    分享链接: (r?.shareUrl ?? '').toString()
  }));

  const ws = XLSX.utils.json_to_sheet(rows, {skipHeader: false});
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '数据');

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const filename = `月榜单_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`;

  const data = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
</script>

<template>
  <div class="container">
    <div v-if="modalVisible" class="modal-mask" @click.self="closeModal">
      <div class="modal-card">
        <div class="modal-title">提示</div>
        <div class="modal-content">{{ modalMessage }}</div>
        <div class="modal-actions">
          <button type="button" class="modal-ok" @click="closeModal">确定</button>
        </div>
      </div>
    </div>

    <div class="webview-container">
      <webview 
        src="https://jigou.kuaishou.com/" 
        class="webview"
        ref="webviewRef"
        allowpopups
      ></webview>
    </div>
    <div class="control-panel">
      <h2>鱼粉快手月榜单采集</h2>
      <div class="collect-row">
        <div class="page-input-row">
          <label class="page-input-label" for="page-count-input">采集页数</label>
          <input
            id="page-count-input"
            v-model.number="pageCount"
            type="number"
            min="1"
            step="1"
            class="page-input"
            :disabled="isCollecting || isCleaning || isUploadingToBaidu"
          />
        </div>
        <button @click="handleButtonClick" class="control-button collect-button" :disabled="isCollecting || isCleaning || isUploadingToBaidu">
          采集数据
        </button>
      </div>
      <div class="action-row">
        <button @click="handleCleanButtonClick" class="control-button clean-button action-button" :disabled="isCollecting || isCleaning || isUploadingToBaidu || collectedRows.length === 0 || !arkApiKey.trim()">
          {{ isCleaning ? '清洗中...' : '数据清洗' }}
        </button>
        <button @click="handleUploadToBaiduClick" class="control-button baidu-button action-button" :disabled="isCollecting || isCleaning || isUploadingToBaidu || collectedRows.length === 0">
          {{ isUploadingToBaidu ? '上传中...' : '上传百度网盘' }}
        </button>
        <button @click="handleExportExcelClick" class="control-button export-button action-button" :disabled="isCollecting || isCleaning || isUploadingToBaidu || collectedRows.length === 0">
          导出Excel
        </button>
      </div>

      <div class="ark-key-panel">
        <input
          v-model="arkApiKey"
          class="ark-key-input"
          placeholder="Ark API Key（必填，用于大模型清洗）"
          :disabled="isCollecting || isCleaning || isUploadingToBaidu"
        />
        <button type="button" class="ark-key-action" @click="saveArkApiKey" :disabled="isCollecting || isCleaning || isUploadingToBaidu">
          保存
        </button>
        <button type="button" class="ark-key-action" @click="clearArkApiKey" :disabled="isCollecting || isCleaning || isUploadingToBaidu">
          清除
        </button>
      </div>

      <div class="result-panel">
        <div v-if="collectedRows.length === 0" class="result-hint">{{ isCollecting ? '采集中...' : '暂无数据' }}</div>
        <div v-else-if="isCollecting" class="result-hint">采集中...</div>
        <div v-else-if="isCleaning" class="result-hint">清洗中... ({{ cleaningProgress.done }}/{{ cleaningProgress.total }})</div>
        <div v-else-if="isUploadingToBaidu" class="result-hint">上传百度网盘中...</div>
        <table v-if="collectedRows.length > 0" class="result-table">
          <thead>
            <tr>
              <th class="col-title">视频名称</th>
              <th class="col-time">发布时间</th>
              <th class="col-num">播放量</th>
              <th class="col-num">点赞量</th>
              <th class="col-video">视频链接</th>
              <th class="col-share">分享链接</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in collectedRows" :key="idx">
              <td class="cell-title" :title="row.title">{{ row.title }}</td>
              <td class="cell-time">{{ row.publishTime }}</td>
              <td class="cell-num">{{ row.playCount }}</td>
              <td class="cell-num">{{ row.likeCount }}</td>
              <td class="cell-video">
                <a v-if="row.videoUrl && row.videoUrl !== '已删除' && row.videoUrl !== '无链接'" :href="row.videoUrl" target="_blank" class="video-link">查看视频</a>
                <span v-else-if="row.videoUrl === '已删除'" class="deleted-video">已删除</span>
                <span v-else-if="row.videoUrl === '无链接'" class="no-video">无链接</span>
                <span v-else class="no-video"></span>
              </td>
              <td class="cell-share">
                <a v-if="row.shareUrl && row.shareUrl !== '上传失败' && row.shareUrl !== '已删除' && row.shareUrl !== '无链接'" :href="row.shareUrl" target="_blank" class="share-link" :title="row.shareUrl">{{ row.shareUrl }}</a>
                <span v-else-if="row.shareUrl === '上传失败'" class="deleted-video">上传失败</span>
                <span v-else-if="row.shareUrl === '已删除' || row.shareUrl === '无链接'" class="no-video">{{ row.shareUrl }}</span>
                <span v-else class="no-video"></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  height: 100vh;
  width: 100vw;
  margin: 0;
  padding: 0;
}

.webview-container {
  width: 60%;
  height: 100%;
  border-right: 1px solid #ccc;
}

.webview {
  width: 100%;
  height: 100%;
  border: none;
}

.modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-card {
  width: 420px;
  max-width: calc(100vw - 40px);
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin-bottom: 10px;
}

.modal-content {
  font-size: 14px;
  color: #333;
  line-height: 1.6;
  word-break: break-all;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}

.modal-ok {
  height: 32px;
  padding: 0 14px;
  border-radius: 6px;
  border: none;
  background: #007bff;
  color: #fff;
  cursor: pointer;
}

.control-panel {
  width: 40%;
  height: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  background-color: #f5f5f5;
  padding-top: 20px;
  box-sizing: border-box;
}

.result-panel {
  width: 100%;
  margin-top: 16px;
  flex: 1;
  overflow: auto;
}

.result-hint {
  width: 100%;
  padding: 12px;
  text-align: center;
  color: #666;
}

.result-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  background: #fff;
}

.result-table th,
.result-table td {
  border: 1px solid #e5e5e5;
  padding: 8px;
  font-size: 12px;
  vertical-align: middle;
  text-align: center;
}

.result-table th {
  position: sticky;
  top: 0;
  background: #fafafa;
  z-index: 1;
  white-space: nowrap;
}

.col-title {
  width: 34%;
}

.col-time {
  width: 12%;
}

.col-num {
  width: 12%;
}

.col-video {
  width: 15%;
}

.col-share {
  width: 15%;
}

.result-table td.cell-title {
  word-break: break-word;
  text-align: left;
}

.cell-time {
  white-space: nowrap;
}

.cell-num {
  text-align: center;
  white-space: nowrap;
}

.result-table td.cell-share {
  word-break: break-all;
}

.cell-video {
  text-align: center;
  padding: 8px 4px;
}

.video-link {
  color: #007bff;
  text-decoration: none;
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid #007bff;
  border-radius: 3px;
  display: inline-block;
}

.share-link {
  color: #007bff;
  text-decoration: underline;
  font-size: 12px;
}

.video-link:hover {
  background-color: #007bff;
  color: white;
}

.no-video {
  color: #999;
  font-size: 12px;
}

.deleted-video {
  color: #ff4757;
  font-size: 12px;
  font-weight: bold;
}

.control-button {
  padding: 12px 24px;
  font-size: 16px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.action-row {
  width: 100%;
  display: flex;
  gap: 10px;
}

.collect-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.page-input-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.collect-row .page-input-row {
  flex: 1;
  margin-bottom: 0;
}

.page-input-label {
  flex: 0 0 auto;
  font-size: 13px;
  color: #333;
}

.page-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  font-size: 13px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  outline: none;
}

.page-input:disabled {
  background: #f0f0f0;
}

.action-button {
  flex: 1;
  padding: 12px 0;
}

.collect-button {
  flex: 0 0 auto;
}

.ark-key-panel {
  width: 100%;
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.ark-key-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  outline: none;
}

.ark-key-input:disabled {
  background: #f0f0f0;
}

.ark-key-action {
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
  background: #ffffff;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  cursor: pointer;
}

.ark-key-action:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.clean-button {
  background-color: #6c757d;
}

.clean-button:hover {
  background-color: #5a6268;
}

.baidu-button {
  background-color: #198754;
}

.baidu-button:hover {
  background-color: #157347;
}

.control-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.control-button:hover {
  background-color: #0056b3;
}

h2 {
  margin-bottom: 30px;
  color: #333;
}
</style>
