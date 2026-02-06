<script setup lang="ts">
import {ref} from 'vue';

window.electronAPI.sendMessage('App loaded with webview layout!');

const webviewRef = ref<any>(null);
const isCollecting = ref(false);
const collectedRows = ref<Array<{ title: string; publishTime: string; playCount: string; likeCount: string; videoUrl: string }>>([]);

const handleButtonClick = async () => {
  const webview = webviewRef.value;
  if (!webview) {
    console.warn('webview not ready');
    return;
  }

  try {
    isCollecting.value = true;
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

    const safeBaseRows = Array.isArray(baseRows) ? baseRows : [];
    collectedRows.value = safeBaseRows.map((r) => ({...r, videoUrl: ''}));
    console.table(collectedRows.value);
    window.electronAPI.sendMessage(`采集到 ${collectedRows.value.length} 条数据，开始采集视频链接...`);

    for (let i = 0; i < collectedRows.value.length; i++) {
      const videoUrl = await webview.executeJavaScript(
        `(async () => {
          const idx = ${i};

          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

          const trList = Array.from(document.querySelectorAll('tbody tr.ks-table__row'));
          const rowElement = trList[idx];
          if (!rowElement) return '';

          // 已删除检测
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

          // 弹窗打开后等待2秒再取链接
          await sleep(2000);

          const videoElement = document.querySelector('.video-player video');
          const url = (videoElement && (videoElement.src || videoElement.currentSrc)) ? (videoElement.src || videoElement.currentSrc) : '';

          // 再等待2秒再关闭
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

      const normalizedVideoUrl = videoUrl === '已删除' ? '已删除' : (videoUrl ? videoUrl : '无链接');
      collectedRows.value[i] = {...collectedRows.value[i], videoUrl: normalizedVideoUrl};

      // 行与行之间间隔2秒
      if (i < collectedRows.value.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  } catch (e) {
    console.error('采集失败', e);
    window.electronAPI.sendMessage('采集失败');
  } finally {
    isCollecting.value = false;
  }
};
</script>

<template>
  <div class="container">
    <div class="webview-container">
      <webview 
        src="https://jigou.kuaishou.com/" 
        class="webview"
        ref="webviewRef"
        allowpopups
      ></webview>
    </div>
    <div class="control-panel">
      <h2>快手月榜单采集</h2>
      <button @click="handleButtonClick" class="control-button" :disabled="isCollecting">
        采集数据
      </button>

      <div class="result-panel">
        <div v-if="collectedRows.length === 0" class="result-hint">{{ isCollecting ? '采集中...' : '暂无数据' }}</div>
        <div v-else-if="isCollecting" class="result-hint">采集中...</div>
        <table v-if="collectedRows.length > 0" class="result-table">
          <thead>
            <tr>
              <th class="col-title">视频名称</th>
              <th class="col-time">发布时间</th>
              <th class="col-num">播放量</th>
              <th class="col-num">点赞量</th>
              <th class="col-video">视频链接</th>
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
  width: 65%;
  height: 100%;
  border-right: 1px solid #ccc;
}

.webview {
  width: 100%;
  height: 100%;
  border: none;
}

.control-panel {
  width: 35%;
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
  border-collapse: collapse;
  background: #fff;
}

.result-table th,
.result-table td {
  border: 1px solid #e5e5e5;
  padding: 8px;
  font-size: 12px;
  vertical-align: top;
}

.result-table th {
  position: sticky;
  top: 0;
  background: #fafafa;
  z-index: 1;
}

.col-title {
  width: 36%;
}

.col-time {
  width: 18%;
}

.col-num {
  width: 14%;
}

.col-video {
  width: 18%;
}

.cell-title {
  word-break: break-word;
}

.cell-time {
  white-space: nowrap;
}

.cell-num {
  text-align: right;
  white-space: nowrap;
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
